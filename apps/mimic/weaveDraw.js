// weaveDraw.js — draws the Weave timer onto any <canvas data-wp-weave="arc|lane|highway"> on the page, from the state
// the main process pushes (apps/mimic/weave.js, window.mimic.onWeaveState). me.html's HUD ring carries an "arc" (the
// lane curved along the ring), the Box a straight "lane"; the Timers canvas's "Weaving timer" piece is a "highway".
//
// The state carries the engine's numbers (last 2H swing, last fist round, the measured interval), not a picture, so
// every frame here re-derives the windows at the current time with WpWeave.zones — the lane scrolls smoothly
// between pushes. Frames are requested ONLY while a fight is live; idle draws once per push and then nothing runs.
//
// Colours come from the shared theme (theme.css) once a couple of seconds; the fallbacks are rgb() strings, not hex.
(function (root) {
  'use strict';
  var WV = root.WpWeave;
  var states = {}, latest = null, started = false, subscribed = false, raf = 0, colors = null, colorsAt = 0, announced = {};
  var STALE_MS = 1500;   // main pushes every ~33 ms while a fight is on; a "live" state this old is not

  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
  function themed(slot, dflt) {
    try {
      var v = root.getComputedStyle(root.document.documentElement).getPropertyValue('--wp-' + slot).trim();
      return v || dflt;
    } catch (e) { return dflt; }
  }
  function theme() {
    var t = Date.now();
    if (!colors || t - colorsAt > 2000) {
      colorsAt = t;
      colors = { text: themed('text', 'rgb(201,209,217)'), dim: themed('dim', 'rgb(110,118,129)'), blue: themed('blue', 'rgb(88,166,255)'),
        gold: themed('gold', 'rgb(210,153,34)'), green: themed('green', 'rgb(86,211,100)'), red: themed('red', 'rgb(248,81,73)'),
        orange: themed('orange', 'rgb(255,166,87)') };
    }
    return colors;
  }
  function liveOf(st, now) { return !!(st && st.active && st.core && now - st.rx <= STALE_MS); }
  function canvases() { return root.document ? root.document.querySelectorAll('canvas[data-wp-weave]') : []; }
  function pick(cv) {
    var ch = cv.getAttribute('data-wp-char');
    return ch ? (states[lc(ch)] || null) : (latest ? states[latest] : null);
  }
  function fit(cv) {
    var w = cv.clientWidth, h = cv.clientHeight, d = root.devicePixelRatio || 1;
    if (!(w > 0 && h > 0)) return null;
    var pw = Math.round(w * d), ph = Math.round(h * d);
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
    var ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function font(ctx, px, bold) {
    var fam = 'ui-monospace, Consolas, monospace';
    try { fam = root.getComputedStyle(root.document.body).fontFamily || fam; } catch (e) { void e; }
    ctx.font = (bold ? '700 ' : '') + Math.round(px) + 'px ' + fam;
  }
  var KIND_COLOR = { wait: 'blue', go: 'green', late: 'red' };
  var GLYPH = { landed: ['✓', 'green'], clip: ['✕', 'red'], miss: ['·', 'dim'] };

  // The last press's outcome as one glyph, fading out over the last 3 s of its 10.
  function glyph(c, ctx, st, now, cx, cy, px) {
    var o = st && st.outcome;
    if (!o) return;
    var age = now - o.at;
    if (age > 10000) return;
    var g = GLYPH[o.kind];
    if (!g) return;
    ctx.save();
    ctx.globalAlpha = age < 7000 ? 1 : Math.max(0, 1 - (age - 7000) / 3000);
    font(ctx, px, true);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = c[g[1]];
    ctx.fillText(g[0], cx, cy);
    ctx.restore();
  }
  function note(c, ctx, text, w, h) {
    ctx.save();
    ctx.translate(w / 2, h / 2); ctx.rotate(-Math.PI / 2);
    font(ctx, Math.max(8, Math.min(10, w * 0.7)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = c.dim; ctx.globalAlpha = 0.8;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // ── The slim vertical lane (HUD ring, Box) ─────────────────────────────────────────────────────────────────
  // Future is at the top; the windows scroll DOWN to the hit line near the bottom. Blue = wait, green = go,
  // red = late, a thin orange tick where the next 2H swing is due, the last outcome as a glyph under the lane.
  function drawLane(c, f, st, live, now) {
    var ctx = f.ctx, w = f.w, h = f.h, gh = Math.round(Math.max(9, Math.min(14, w * 0.8)));
    var top = 1, hitY = h - gh - 5, span = hitY - top;
    ctx.globalAlpha = live ? 0.3 : 0.16; ctx.fillStyle = c.dim; ctx.fillRect(0, top, w, hitY + 4 - top); ctx.globalAlpha = 1;
    if (!live) {
      if (st && st.source === 'needs-zeal') note(c, ctx, 'needs Zeal', w, hitY);
      glyph(c, ctx, st, now, w / 2, h - gh / 2 - 1, gh);
      return;
    }
    var z = WV.zones(st.core, now, 3);
    if (!z) return;
    var look = 2 * st.core.interval2H, ppm = span / look;
    var yOf = function (t) { return hitY - (t - now) * ppm; };
    ctx.save();
    ctx.beginPath(); ctx.rect(0, top, w, hitY + 4 - top); ctx.clip();
    z.zones.forEach(function (zn) {
      var y0 = yOf(zn.end), y1 = yOf(zn.start), cur = zn.start <= now && now < zn.end;
      ctx.globalAlpha = cur ? 0.95 : 0.42; ctx.fillStyle = c[KIND_COLOR[zn.kind]];
      ctx.fillRect(0, y0, w, Math.max(1, y1 - y0));
    });
    ctx.globalAlpha = 1; ctx.fillStyle = c.orange;
    z.swings.forEach(function (s) { ctx.fillRect(0, yOf(s.at) - 0.75, w, 1.5); });
    ctx.restore();
    ctx.fillStyle = c.text; ctx.fillRect(-1, hitY - 0.75, w + 2, 1.5);
    glyph(c, ctx, st, now, w / 2, h - gh / 2 - 1, gh);
  }

  // ── The curved lane (HUD ring) ─────────────────────────────────────────────────────────────────────────────
  // The guild lead, 2026-11-07: "please curve the line to match the arc for the circle". The canvas covers the ring's
  // 400-unit square and the lane runs along the right arc (data-wp-arc = "radius startDeg endDeg", degrees clockwise
  // from 12 o'clock, me.html's own geometry). The future is at the top of the arc; windows travel down it to the hit
  // tick near the bottom end, and the last outcome sits just past that end.
  function drawArc(c, f, st, live, now, cv) {
    var ctx = f.ctx, s = Math.min(f.w, f.h) / 400, g = String(cv.getAttribute('data-wp-arc') || '172 56 124').split(/\s+/).map(Number);
    var R = g[0] * s, a0 = g[1], a1 = g[2], band = 9 * s, cx = f.w / 2, cy = f.h / 2;
    var rad = function (deg) { return (deg - 90) * Math.PI / 180; };
    var hitA = a1 - 5;
    var arc = function (from, to, color, alpha, width) {
      if (!(to > from)) return;
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width || band;
      ctx.beginPath(); ctx.arc(cx, cy, R, rad(from), rad(to)); ctx.stroke();
    };
    var tick = function (deg, color, width, half) {
      var a = rad(deg), r0 = R - half, r1 = R + half;
      ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)); ctx.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); ctx.stroke();
    };
    var gx = function (deg) { return [cx + R * Math.cos(rad(deg)), cy + R * Math.sin(rad(deg))]; };
    ctx.save();
    ctx.lineCap = 'butt';
    arc(a0, a1, c.dim, live ? 0.3 : 0.16);
    var gp = gx(a1 + 7), gpx = Math.max(9, 14 * s);
    if (!live) {
      ctx.restore();
      glyph(c, ctx, st, now, gp[0], gp[1], gpx);
      return;
    }
    var z = WV.zones(st.core, now, 3);
    if (!z) { ctx.restore(); return; }
    var dpm = (hitA - a0) / (2 * st.core.interval2H);
    var aOf = function (t) { return hitA - (t - now) * dpm; };
    z.zones.forEach(function (zn) {
      var from = Math.max(a0, aOf(zn.end)), to = Math.min(hitA, aOf(zn.start)), cur = zn.start <= now && now < zn.end;
      arc(from, to, c[KIND_COLOR[zn.kind]], cur ? 0.95 : 0.42);
    });
    z.swings.forEach(function (sw) { var a = aOf(sw.at); if (a >= a0 && a <= hitA) tick(a, c.orange, 1.5, band / 2); });
    tick(hitA, c.text, 1.5, band / 2 + 2 * s);
    ctx.restore();
    glyph(c, ctx, st, now, gp[0], gp[1], gpx);
  }

  // ── The timing highway (the Canvas piece) ──────────────────────────────────────────────────────────────────
  // Boxes scroll right to left into the gold hit zone; under them the offhand (fist) cooldown; CLIPPED flashes
  // red; the fight tally at the right.
  function drawHighway(c, f, st, live, now) {
    var ctx = f.ctx, w = f.w, h = f.h, px = Math.max(9, Math.min(13, h * 0.2));
    var head = Math.round(px + 3), barH = Math.max(5, Math.round(h * 0.1)), foot = barH + 4;
    var laneTop = head, laneH = Math.max(8, h - head - foot), laneBot = laneTop + laneH, hz = Math.round(w * 0.2);
    ctx.globalAlpha = live ? 0.3 : 0.16; ctx.fillStyle = c.dim; ctx.fillRect(0, laneTop, w, laneH); ctx.globalAlpha = 1;
    if (!live) {
      font(ctx, px); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = c.dim;
      ctx.fillText(st && st.source === 'needs-zeal' ? 'Weaving timer: needs Zeal' : 'Weaving timer: waiting for a fight', 2, head / 2);
      glyph(c, ctx, st, now, w - px, head / 2, px + 2);
      return;
    }
    var z = WV.zones(st.core, now, 3);
    if (!z) return;
    var look = 2 * st.core.interval2H, ppm = (w - hz - 3) / look;
    var xOf = function (t) { return hz + (t - now) * ppm; };
    ctx.save();
    ctx.beginPath(); ctx.rect(0, laneTop, w, laneH); ctx.clip();
    z.zones.forEach(function (zn) {
      var x0 = xOf(zn.start), x1 = xOf(zn.end), cur = zn.start <= now && now < zn.end;
      ctx.globalAlpha = cur ? 0.95 : 0.42; ctx.fillStyle = c[KIND_COLOR[zn.kind]];
      ctx.fillRect(x0, laneTop, Math.max(1, x1 - x0), laneH);
    });
    ctx.globalAlpha = 1; ctx.fillStyle = c.orange;
    z.swings.forEach(function (s) { ctx.fillRect(xOf(s.at) - 0.75, laneTop, 1.5, laneH); });
    ctx.restore();
    ctx.strokeStyle = c.gold; ctx.lineWidth = 2; ctx.strokeRect(hz - 3, laneTop - 1, 6, laneH + 2);
    // the offhand cooldown: full and green when the fist is ready, filling blue until then
    var fiv = st.core.fistInterval, lf = st.core.lastFist, fr = lf == null ? 1 : Math.max(0, Math.min(1, (now - lf) / fiv));
    ctx.globalAlpha = 0.3; ctx.fillStyle = c.dim; ctx.fillRect(0, laneBot + 3, w, barH); ctx.globalAlpha = 1;
    ctx.fillStyle = fr >= 1 ? c.green : c.blue; ctx.fillRect(0, laneBot + 3, w * fr, barH);
    // the head row: the phase, the clip flash, the tally
    var phase = z.derived.phase;
    font(ctx, px, true); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = phase === 'go' ? c.green : phase === 'late' ? c.red : phase === 'wait' ? c.blue : c.orange;
    ctx.fillText(phase === 'go' ? 'PRESS' : phase === 'late' ? 'LATE' : phase === 'wait' ? 'WAIT' : 'SWING', 2, head / 2);
    var o = st.outcome;
    if (o && o.kind === 'clip' && now - o.at < 1500) {
      ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(now / 120)); ctx.fillStyle = c.red; ctx.textAlign = 'center';
      ctx.fillText('CLIPPED', w / 2, head / 2); ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'right';
    var tx = w - 2;
    if (st.cfg && st.cfg.showTally !== false && st.tally && st.tally.presses) {
      font(ctx, px - 1); ctx.fillStyle = c.text;
      var t = st.tally;
      ctx.fillText(t.landed + '✓ ' + t.clips + '✕ ' + t.misses + '·', tx - px - 6, head / 2);
    }
    glyph(c, ctx, st, now, tx - px / 2, head / 2, px + 2);
  }

  // Ask main for the states the first time a lane is actually on screen (a hidden lane, or a page with none, costs
  // main nothing). A Canvas piece also says whose lane it is, so the engine knows the class and level with no HUD open.
  function subscribe() {
    if (subscribed || !(root.mimic && root.mimic.onWeaveState)) return;
    subscribed = true;
    root.mimic.onWeaveState(onState);
  }
  function announce(cv) {
    var ch = cv.getAttribute('data-wp-char'), lv = cv.getAttribute('data-wp-level'), cls = cv.getAttribute('data-wp-cls');
    if (!ch || !lv || !(root.mimic && root.mimic.setWeaveConfig)) return;
    var key = ch + '|' + cls + '|' + lv;
    if (announced[ch] === key) return;
    announced[ch] = key;
    root.mimic.setWeaveConfig({ character: ch, cls: String(cls || '').toLowerCase(), level: Number(lv), partial: true });
  }
  function drawOne(cv, now) {
    var f = fit(cv);
    if (!f) return false;
    subscribe(); announce(cv);
    var st = pick(cv), live = liveOf(st, now), c = theme();
    var kind = cv.getAttribute('data-wp-weave');
    (kind === 'highway' ? drawHighway : kind === 'arc' ? drawArc : drawLane)(c, f, st, live, now, cv);
    return live;
  }
  function frame() {
    raf = 0;
    var now = Date.now(), any = false, list = canvases();
    for (var i = 0; i < list.length; i++) if (drawOne(list[i], now)) any = true;
    if (any) raf = root.requestAnimationFrame(frame);   // idle = no frames requested
  }
  function schedule() { if (!raf && root.requestAnimationFrame) raf = root.requestAnimationFrame(frame); }

  function onState(st) {
    if (!st || typeof st.character !== 'string') return;
    st.rx = Date.now();
    var k = lc(st.character);
    states[k] = st;
    if (st.active || latest == null || !states[latest] || !states[latest].active) latest = k;
    schedule();
  }
  // Begin listening (once). A canvas that appears later (the Box repaint, a Canvas piece placed) is drawn when it does.
  function start() {
    if (started) return;
    started = true;
    if (root.MutationObserver && root.document) {
      new root.MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) for (var j = 0; j < muts[i].addedNodes.length; j++) {
          var n = muts[i].addedNodes[j];
          if (n.nodeType === 1 && (n.matches && n.matches('canvas[data-wp-weave]') || n.querySelector && n.querySelector('canvas[data-wp-weave]'))) { schedule(); return; }
        }
      }).observe(root.document.documentElement, { childList: true, subtree: true });
    }
    schedule();
  }

  root.WpWeaveDraw = { start: start, redraw: schedule, _onState: onState };
})(window);
