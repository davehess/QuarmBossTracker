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
//    radius change and lap-time change against the lap before it are all small and it turned the same way;
//  * a lap that drifts gets a likely CAUSE when its own steps show one (lapSignals / causeOf, bars in K.CAUSE_*): speed
//    changed, turn input, pushed, warp/lag, slope. Nothing clears a bar: nothing is said.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WPKite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TAU = Math.PI * 2;
  var K = {
    RUN_BASE_UPS: 30.3,       // 100% run, units a second (map.html RUN_BASE_UPS, measured)
    PATH_STEP_MS: 400,        // samples joined for the walked distance are at least this far apart
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
    // The likely cause of a drifting lap (the guild lead, 2026-10-23). Holding forward + a turn key turns at a constant
    // rate, so the lap TIME is fixed and the RADIUS is speed / turn rate: a circle drifts only when the speed or the turn
    // changes for part of a lap, or something moves you. The lap's own steps (samples PATH_STEP_MS apart) are read for
    // each; a tag is shown only when a signal clears its bar, and the strongest (score = signal / bar) wins.
    CAUSE_MIN: 0.05,          // a lap is looked at from the moment its chip leaves green (drift >= DRIFT_GREEN of r)
    CAUSE_PARTS: 4,           // speed and turn are compared between this many equal slices of the lap's time
    CAUSE_LEAD_MS: 1200,      // samples this far before a lap are read too, so its first steps have one to be predicted from
    CAUSE_MAX_DT: 1000,      // a step longer than this (a lag hole) tells nothing about speed or heading: left out
    // The bars sit about twice over what a PERFECT circle reads with 0.5 u of positional noise (synthetic laps, 10 Hz: speed
    // slices differ by <=5%, the heading strays <=0.05 rad from a steady turn, a step is off by <1 u). Not yet tuned on real
    // kite data. A drift of 5% of r comes from a speed change of only ~3% over half a lap, so the small drifts have no cause
    // that clears a bar: no tag.
    CAUSE_SPEED: 0.10,        // "speed changed": the fastest and slowest slice differ by >10% of the mean (or lap vs lap before)
    CAUSE_TURN: 0.10,         // "turn input": the heading strays this many radians (5.7 deg) from a steady turn
    CAUSE_PUSH_U: 4,          // "pushed": a step is this far (units) off where the step before it, kept turning, predicts
    CAUSE_WARP_U: 20,         // "warp/lag": ... and this far or more is no shove any more, it is a jump
    CAUSE_SLOPE_Z: 4,         // "slope": the ground rose or fell this much in a slice (a step is ~6 u tall) ...
    CAUSE_SLOPE_CORR: 0.9,    //   ... and the slices' speeds follow the slices' rise (|correlation|)
    // Other people's circles on your Map (the guild lead, 2026-10-26: "i can't hide <another character>'s circles from
    // yesterday"). The guild library keeps a loop for weeks (utils/kiteLoops.js fades it over ~14 days) and stamps it with
    // last_at, the last time ANYONE ran it. The Map used to draw all of them for ever. "Live" draws only a loop run this
    // recently. The agent caches the bot's list for 10 minutes and the Map asks the agent once a minute, so a loop being run
    // right now can show up to ~11 minutes late: the window has to be longer than that, or a live circle never appears.
    OTHERS_LIVE_MS: 20 * 60 * 1000,
    // "My speed" keeps a loop whose lap time is within this share of YOUR circle's lap time (+-25%: a 12 s lap keeps 9 to 15 s).
    SPEED_BAND: 0.25,
    // "Near me" keeps a loop whose centre is within this many units of where you stand (a loop's radius is 20-500; 300 u is
    // about a screen's width at the default zoom).
    NEAR_UNITS: 300,
    // The drift forecast (an arrow to a thin ring where your circle lands; chosen from the mocks over faint copies of the
    // circle, whose copies sat inside the circle at a drift of a unit or two a lap). One lap moves a clean circle a unit or
    // two, which is a pixel or two on the Map: so the forecast looks as many whole laps ahead as it takes for the landing to
    // stand this many pixels off, and stops at DRIFT_LAPS_MAX laps (about two minutes of kiting): past that it is a guess
    // about nothing the data shows.
    DRIFT_STEP_PX: 36, DRIFT_LAPS_MAX: 20,
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

  // Speed as % of a normal run, from the path actually walked (Zeal prints the speed you move at, so a lap that is a
  // rounded square or an oval has to count its real length: 2 pi r of the fitted circle reads ~10% short on a squarish
  // loop, 102% against Zeal's 116%, 2026-10-23). Jitter would add up at 10-20 samples a second, so only samples at least
  // PATH_STEP_MS apart are joined (a 400 ms chord at 35-60 u/s is 14-24 u: noise of a unit or two is under 1%).
  function pathUps(pts) {
    if (!pts || pts.length < 2) return 0;
    var a = pts[0], last = a, len = 0;
    for (var i = 1; i < pts.length; i++) {
      if (pts[i].t - a.t >= K.PATH_STEP_MS) { len += Math.hypot(pts[i].x - a.x, pts[i].y - a.y); a = pts[i]; last = a; }
    }
    return last.t > pts[0].t ? len / (last.t - pts[0].t) * 1000 : 0;
  }
  function speedPct(ups) { return ups > 0 ? ups / K.RUN_BASE_UPS * 100 : 0; }

  // ── What moved the circle: the signals a lap's own samples carry, and the classifier over them ──
  // Steps are the samples joined PATH_STEP_MS apart (as pathUps does). Every signal is read from the STEPS (their length per
  // time and the way they point), never from the fitted centre, which is the thing that drifted.
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function lapSteps(pts) {
    var out = [], a = pts[0];
    for (var i = 1; i < pts.length; i++) {
      var b = pts[i], dt = b.t - a.t;
      if (dt < K.PATH_STEP_MS) continue;
      var d = Math.hypot(b.x - a.x, b.y - a.y);
      out.push({ t0: a.t, t1: b.t, dt: dt, d: d, v: d / dt * 1000, cx: b.x - a.x, cy: b.y - a.y, h: Math.atan2(b.y - a.y, b.x - a.x), z0: a.z || 0, z1: b.z || 0,
        gap: dt > K.CAUSE_MAX_DT || d < 1, bad: false });
      a = b;
    }
    return out;
  }
  // { parts: [{ v (u/s), turn (rad/s, the lap's way), dz } | null] x CAUSE_PARTS, vSteady (u/s), jump } or null.
  //  * a JUMP is a step that lands `u` units away from where the step before it, kept turning at the lap's usual rate,
  //    predicts (step vector = the last one, turned by the usual turn and scaled by the time): a shove, lag that catches
  //    up, a server correction. A displacement shows as a PAIR, the step it hit off by D and the next one off by about -D
  //    (it is predicted from the hit one); a change of speed or of turn is off once, at the change, and then steady. The
  //    pair is what is told apart from them. The hit step then leaves the slices' speed and turn (it would read as
  //    "speed changed"). Under CAUSE_PUSH_U is noise (a unit or two on a 14 u step); from CAUSE_WARP_U it is a "warp/lag".
  // `pts` may start before the lap (`lapStart`, ms): the steps that end before it are only there so the first steps of the
  // lap have one to be predicted from (a shove in the lap's first step has no pair otherwise). They count for nothing else.
  function lapSignals(pts, lapStart) {
    if (!pts || pts.length < 8) return null;
    var t0 = lapStart != null ? lapStart : pts[0].t, st = lapSteps(pts), P = K.CAUSE_PARTS, span = pts[pts.length - 1].t - t0, i, j, s;
    st.forEach(function (x) { x.pre = x.t1 <= t0; });
    var good = st.filter(function (x) { return !x.gap && !x.pre; });
    if (good.length < 8 || !(span > 0)) return null;
    var sig = { parts: [], vSteady: 0, jump: null, turnDev: null };
    // The turn each step made from the one before (the lap's way round, so it is positive on a good circle), per ms.
    var tr = [], sum = 0, trs = [];
    for (i = 0; i < st.length; i++) {
      tr.push(i && !st[i].gap && !st[i - 1].gap ? wrap(st[i].h - st[i - 1].h) : null);
      if (tr[i] != null) sum += tr[i];
    }
    var sgn = sum < 0 ? -1 : 1;
    for (i = 0; i < st.length; i++) if (tr[i] != null) { tr[i] *= sgn; trs.push(tr[i] / ((st[i].dt + st[i - 1].dt) / 2)); }
    var medW = median(trs) * sgn;                                  // radians a ms, in the frame's own sense
    var res = [], rot = [];
    for (i = 0; i < st.length; i++) {
      res.push(null); rot.push(0);
      if (!i || st[i].gap || st[i - 1].gap) continue;
      var an = medW * (st[i].dt + st[i - 1].dt) / 2, ca = Math.cos(an), sa = Math.sin(an), k = st[i].dt / st[i - 1].dt;
      rot[i] = an;
      res[i] = { x: st[i].cx - k * (ca * st[i - 1].cx - sa * st[i - 1].cy), y: st[i].cy - k * (sa * st[i - 1].cx + ca * st[i - 1].cy) };
    }
    for (j = 1; j + 1 < st.length; j++) {
      if (!res[j] || !res[j + 1] || st[j].pre) continue;
      var u = Math.hypot(res[j].x, res[j].y), c2 = Math.cos(rot[j + 1]), s2 = Math.sin(rot[j + 1]);
      // the next step should be off by -D, turned the same way
      var bx = res[j + 1].x + (c2 * res[j].x - s2 * res[j].y), by = res[j + 1].y + (s2 * res[j].x + c2 * res[j].y);
      if (u < K.CAUSE_PUSH_U || Math.hypot(bx, by) > 0.5 * u) continue;
      if (!sig.jump || u > sig.jump.u) sig.jump = { u: u, at: Math.max(0, st[j].t0 - t0) / 1000, j: j };
    }
    if (sig.jump) st[sig.jump.j].bad = true;
    // Turn: the heading of the steps, unwrapped, against the straight line of a steady turn. Turn input shows as the biggest
    // distance (radians) from that line, which is much steadier than comparing slices' rates (a rate is two noisy headings
    // over a short stretch; this uses every step). null for fewer than 8 steps or a hole in the lap.
    // Each heading is read over two steps joined (~0.8 s, ~28 u): the same tangent on a circle, half the noise of one step.
    var us = [], accH = 0, lastH = null, lastT = 0, holed = false;
    for (i = 0; i + 1 < st.length && !holed; i++) {
      s = st[i];
      if (s.gap || s.bad || s.pre || st[i + 1].gap || st[i + 1].bad) continue;
      var tm = (s.t0 + st[i + 1].t1) / 2, hh = Math.atan2(s.cy + st[i + 1].cy, s.cx + st[i + 1].cx);
      if (lastH != null) { if (tm - lastT > 1500) holed = true; accH += sgn * wrap(hh - lastH); }
      lastH = hh; lastT = tm;
      us.push({ x: tm - t0, y: accH });
    }
    if (!holed && us.length >= 8) {
      var mx = 0, my = 0, sxx = 0, sxy = 0;
      us.forEach(function (p) { mx += p.x; my += p.y; });
      mx /= us.length; my /= us.length;
      us.forEach(function (p) { sxx += (p.x - mx) * (p.x - mx); sxy += (p.x - mx) * (p.y - my); });
      var sl = sxx > 0 ? sxy / sxx : 0, dev = 0, devAt = 0;
      us.forEach(function (p) { var e = Math.abs(p.y - (my + sl * (p.x - mx))); if (e > dev) { dev = e; devAt = p.x; } });
      sig.turnDev = { dev: dev, at: devAt / 1000 };
    }
    var acc = [], vn = 0, vd = 0;
    for (i = 0; i < P; i++) acc.push({ vn: 0, vd: 0, tn: 0, td: 0, z0: null, z1: 0 });
    for (i = 0; i < st.length; i++) {
      s = st[i];
      if (s.gap || s.pre) continue;
      var a = acc[Math.max(0, Math.min(P - 1, Math.floor(((s.t0 + s.t1) / 2 - t0) / span * P)))];
      if (a.z0 == null) a.z0 = s.z0;
      a.z1 = s.z1;
      if (s.bad) continue;
      a.vn += s.d; a.vd += s.dt; vn += s.d; vd += s.dt;
      if (tr[i] != null && !st[i - 1].bad) { a.tn += tr[i]; a.td += (s.dt + st[i - 1].dt) / 2; }
    }
    var need = 0.4 * span / P;   // a slice with less than this much good time says nothing
    sig.parts = acc.map(function (a) {
      return a.vd >= need ? { v: a.vn / a.vd * 1000, turn: a.td >= need ? a.tn / a.td * 1000 : null, dz: a.z1 - a.z0 } : null;
    });
    sig.vSteady = vd > 0 ? vn / vd * 1000 : 0;
    return sig;
  }
  // The slices' spread of one signal: { rel: (highest - lowest) / mean, from, to } (from = the earlier of the two), or null.
  function spread(parts, key) {
    var xs = [], i, m = 0;
    for (i = 0; i < parts.length; i++) if (parts[i] && parts[i][key] != null) { xs.push({ i: i, x: parts[i][key] }); m += parts[i][key]; }
    if (xs.length < 3) return null;
    m /= xs.length;
    if (!(m > 0)) return null;
    var lo = xs[0], hi = xs[0];
    xs.forEach(function (p) { if (p.x < lo.x) lo = p; if (p.x > hi.x) hi = p; });
    return { rel: (hi.x - lo.x) / m, from: lo.i < hi.i ? lo.x : hi.x, to: lo.i < hi.i ? hi.x : lo.x };
  }
  function correl(a, b) {
    var n = a.length, ma = 0, mb = 0, i, saa = 0, sbb = 0, sab = 0;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    for (i = 0; i < n; i++) { saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); sab += (a[i] - ma) * (b[i] - mb); }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }
  function nm(v, dp) { var m = Math.pow(10, dp || 0); return String(Math.round(v * m) / m); }
  // What most likely moved this lap's centre, or null (never a guess: nothing clears its bar, nothing is said). Looked at
  // from the moment the drift chip leaves green. { kind, why, score }: `kind` is the word on the coach line, `why` the numbers
  // behind it for the tooltip. Each candidate scores its signal / its bar; the highest one at 1 or more is shown.
  function causeOf(lap, prev) {
    var sig = lap && lap.sig, c = [];
    if (!sig || lap.drift == null || !(lap.drift >= K.CAUSE_MIN * lap.r)) return null;
    var pg = prev && prev.sig ? prev : null;
    // A shove moves the centre for good, so it is read twice: in its own lap (the centre of a lap that was half before it)
    // and in the lap after (against that blended lap). The second says "in the lap before".
    [[sig.jump, ' s into the lap'], [pg && pg.sig.jump, ' s into the lap before']].forEach(function (x) {
      var jp = x[0];
      if (!jp) return;
      var big = jp.u >= K.CAUSE_WARP_U, jt = nm(jp.u) + ' u in one step, ' + nm(jp.at, 1) + x[1];
      c.push(big ? { kind: 'warp/lag', score: jp.u / K.CAUSE_WARP_U, why: 'jumped ' + jt }
        : { kind: 'pushed', score: jp.u / K.CAUSE_PUSH_U, why: 'shoved ' + jt });
    });
    var sp = spread(sig.parts, 'v'), pct = function (ups) { return nm(speedPct(ups)); };
    var spd = sp ? { score: sp.rel / K.CAUSE_SPEED, within: true, why: 'speed ' + pct(sp.from) + '%→' + pct(sp.to) + '% within the lap' } : null;
    if (pg && pg.sig.vSteady > 0 && sig.vSteady > 0) {   // the lap after a change: all one speed, but not the one before it
      var dv = Math.abs(sig.vSteady - pg.sig.vSteady) / pg.sig.vSteady;
      if (!spd || dv / K.CAUSE_SPEED > spd.score) spd = { score: dv / K.CAUSE_SPEED, within: false, why: 'speed ' + pct(pg.sig.vSteady) + '%→' + pct(sig.vSteady) + '% since the lap before' };
    }
    if (spd) {
      spd.kind = 'speed changed';
      // Slope: the slices' speeds follow the slices' rise or fall of the ground (a closed lap ends where it began, so a
      // hill is up in one slice and down in another). Only from the within-lap read, and only on real height.
      var ps = sig.parts.filter(function (p) { return !!p; });
      var dz = ps.map(function (p) { return p.dz; }), maxDz = Math.max.apply(null, dz.map(Math.abs));
      if (spd.within && ps.length >= 3 && maxDz >= K.CAUSE_SLOPE_Z
        && Math.abs(correl(ps.map(function (p) { return p.v; }), dz)) >= K.CAUSE_SLOPE_CORR) {
        spd.kind = 'slope'; spd.why = 'ground moved ' + nm(maxDz) + ' u in a slice; ' + spd.why;
      }
      c.push(spd);
    }
    // Turn is read within the lap only: the lap time against the lap before would be the turn rate upside down (a lap is a
    // fixed angle), but a lap is counted around the running centre, which is the thing that just moved.
    if (sig.turnDev) {
      var tp = spread(sig.parts, 'turn'), deg = function (r) { return nm(r * 180 / Math.PI); };
      c.push({ kind: 'turn input', score: sig.turnDev.dev / K.CAUSE_TURN,
        why: 'heading ' + deg(sig.turnDev.dev) + '° off a steady turn, ' + nm(sig.turnDev.at, 1) + ' s into the lap' + (tp ? '; turn ' + deg(tp.from) + '→' + deg(tp.to) + ' °/s' : '') });
    }
    var best = null;
    c.forEach(function (x) { if (x.score >= 1 && (!best || x.score > best.score)) best = x; });
    return best;
  }

  // One lap from the samples walked during it (`lead`: the few samples just before it, for the cause signals only).
  function lapFrom(pts, t0, t1, n, lead) {
    var f = fitCircle(subsample(pts, K.FIT_PTS));
    if (!f || pts.length < 2) return null;
    var tn = turned(pts, f.cx, f.cy), lapS = (t1 - t0) / 1000;
    return { n: n, cx: f.cx, cy: f.cy, cz: mean(pts, 'z'), r: f.r, sd: f.sd, lapS: lapS,
      speedPct: speedPct(pathUps(pts)), dir: tn.signed >= 0 ? 'cw' : 'ccw',
      t0: t0, t1: t1, drift: null, driftDx: 0, driftDy: 0, dr: null, clean: false, sig: lapSignals(lead && lead.length ? lead.concat(pts) : pts, t0), cause: null };
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
  // `Lap 12.4 s · r 118 · drift 6 u NE · wobble 4 · 104%` (drift is a dash until there is a lap to compare with). A lap whose
  // drift has a likely cause says it right after the drift: `drift 6 u NE ← speed changed`.
  function chipText(lap) {
    if (!lap) return '';
    var dr = lap.drift == null ? '-' : num(lap.drift) + ' u' + (lap.drift >= 0.5 ? ' ' + compass(lap.driftDx, lap.driftDy) : '') + (lap.cause ? ' ← ' + lap.cause.kind : '');
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

  // ── Other people's circles: which ones the Map draws ──
  // `loops` is the guild list (utils/kiteLoops.js rows through the agent). `o`:
  //   others  'live' (default) a loop run in the last OTHERS_LIVE_MS · 'all' the whole library (off is the Map's own switch)
  //   filter  'all' (default) · 'speed' lap time within SPEED_BAND of `cur` (your current circle) · 'near' centre within NEAR_UNITS of `pos`
  //   now     ms epoch · cur  your circle ({ lapS }) or null · pos  where you stand ({ x, y }) or null
  // "My speed" with no circle of yours yet, or "Near me" with no position, has nothing to compare with and keeps the loop:
  // hiding everything because the reference is missing would read as "no loops here".
  function loopFresh(L, now) {
    var t = L && typeof L.last_at === 'string' ? Date.parse(L.last_at) : NaN;
    return isFinite(t) && now - t <= K.OTHERS_LIVE_MS;       // no usable stamp: age unknown, so not "live"
  }
  function filterLoops(loops, o) {
    o = o || {};
    var others = o.others || 'live', filter = o.filter || 'all', out = [];
    for (var i = 0; i < (loops || []).length; i++) {
      var L = loops[i];
      if (!L) continue;
      if (others === 'live' && !loopFresh(L, o.now)) continue;
      if (filter === 'speed' && o.cur && o.cur.lapS > 0 && Math.abs(L.lap_s - o.cur.lapS) > K.SPEED_BAND * o.cur.lapS) continue;
      if (filter === 'near' && o.pos && Math.hypot(L.cx - o.pos.x, L.cy - o.pos.y) > K.NEAR_UNITS) continue;
      out.push(L);
    }
    return out;
  }

  // ── The drift forecast: where your circle will be ──
  // `view` is the coach's view (cur = this lap, ghost = the lap before). The centre has moved (dx, dy) from the ghost to
  // cur; if that holds, lap k is at cur + k (dx, dy). One lap is a pixel or two, so the forecast looks `m` laps ahead
  // (m = enough that the landing is >= stepPx on screen, 1 up to DRIFT_LAPS_MAX) and gives the circle there.
  // null when there is no drift worth drawing (the view's own showArrow bar: 3% of r) or nothing to scale by.
  function driftForecast(view, pxPerUnit, stepPx) {
    if (!view || !view.showArrow || !view.ghost || !view.cur || !(pxPerUnit > 0)) return null;
    var cur = view.cur, dx = cur.cx - view.ghost.cx, dy = cur.cy - view.ghost.cy, per = Math.hypot(dx, dy);
    if (!(per > 0)) return null;
    var m = Math.max(1, Math.min(K.DRIFT_LAPS_MAX, Math.ceil((stepPx || K.DRIFT_STEP_PX) / (per * pxPerUnit))));
    var land = { laps: m, cx: cur.cx + dx * m, cy: cur.cy + dy * m, r: cur.r, secs: m * cur.lapS, units: per * m };
    return { dx: dx, dy: dy, perLap: per, dir: compass(dx, dy), m: m, land: land };
  }
  // `6 laps · 38 s: 14 u SW` (the landing: its laps, how long that is, how far the centre goes)
  function forecastLabel(f) {
    var pt = f.land;
    return pt.laps + ' lap' + (pt.laps === 1 ? '' : 's') + ' · ' + Math.round(pt.secs) + ' s: ' + Math.round(pt.units) + ' u ' + f.dir;
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
        chip: chipText(cur), why: cur.cause ? cur.cause.why : '', laps: eng.nLaps, streak: eng.streak.length, reported: eng.reported };
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
        return { cx: f.cx, cy: f.cy, r: f.r, sd: f.sd, cz: mean(w, 'z'), lapS: dur / 1000 / laps, speedPct: speedPct(pathUps(w)),
          dir: tn.signed > 0 ? 'cw' : 'ccw', t0: w[0].t, t1: w[w.length - 1].t, n: 0, drift: null, driftDx: 0, driftDy: 0, dr: null, clean: false, provisional: true };
      }
      return null;
    }

    function disengage(reason, out) {
      eng = null; view = null;
      out.push({ type: 'disengage', reason: reason });
    }

    function finishLap(tCross, out) {
      var pts = [], lead = [];
      for (var i = buf.length - 1; i >= 0 && buf[i].t > eng.lapT0; i--) pts.push(buf[i]);
      for (; i >= 0 && buf[i].t > eng.lapT0 - K.CAUSE_LEAD_MS; i--) lead.push(buf[i]);
      pts.reverse(); lead.reverse();
      var lap = pts.length >= 6 ? lapFrom(pts, eng.lapT0, tCross, ++eng.nLaps, lead) : null;
      if (!lap || !isCircle(lap)) { disengage('not a circle', out); return; }
      var prev = eng.last;
      lap.drift = Math.hypot(lap.cx - prev.cx, lap.cy - prev.cy);
      lap.driftDx = lap.cx - prev.cx; lap.driftDy = lap.cy - prev.cy;
      lap.dr = lap.r - prev.r;
      lap.cause = causeOf(lap, prev);
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
    cleanLap: cleanLap, pathUps: pathUps, lapSignals: lapSignals, causeOf: causeOf, matchGuild: matchGuild, guildText: guildText, guildLabel: guildLabel, guildDot: guildDot,
    loopFresh: loopFresh, filterLoops: filterLoops, driftForecast: driftForecast, forecastLabel: forecastLabel };
});
