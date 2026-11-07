/* סיור למרינה - an automatic Street View tour from the building (Kountouriotou 161, Piraeus) to Zea Marina.
 * Prototype for The Harbour page (labs/marina-tour; the live app is not touched).
 *
 * Official Maps JavaScript API objects only:
 *   - StreetViewPanorama: at most TWO per page (A = the view at the building, B = created on the first tour; the one
 *     underneath preloads the next step and the top one fades into it). Both are reused for every replay, so a
 *     session is two Dynamic Street View loads however often the tour plays. ?buffer=1 uses only A (one load); it is
 *     the default on touch devices (phones, iPad) until the two-panorama mode has passed a real run there.
 *   - StreetViewService: metadata (position, links, capture month) of the next steps, for the heading and to dissolve
 *     a change of capture slowly - not billed, kept in memory for this page only.
 *   - Map + Polyline + Circle: the mini-map (one Dynamic Maps load), drawn with OUR OpenStreetMap route line.
 * Nothing Google returns is stored: tour.json holds pano IDs (cacheable) and our own OSM data. No Street View imagery
 * is fetched, cached or captured by this page.
 * URL: ?autoplay=1 starts the tour by itself (the app's one click), ?embed=1 (or inside an iframe) hides the top bar
 * and offers "חזרה למודל", ?lang=en English, ?buffer=1|2, ?google=0 a no-Google demo of the whole UI.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const RAW_KEY = window.MARINA_KEY;
  let KEY = typeof RAW_KEY === 'string' && RAW_KEY && RAW_KEY.indexOf('__MARINA') !== 0 ? RAW_KEY : null;
  try { delete window.MARINA_KEY; } catch (e) { window.MARINA_KEY = undefined; } // keep the key out of globals

  let EMBED = false; try { EMBED = qs.get('embed') === '1' || window.parent !== window; } catch (e) { EMBED = true; }
  const AUTOPLAY = qs.get('autoplay') === '1';
  const LANG = qs.get('lang') === 'en' ? 'en' : 'he';
  let COARSE = false; try { COARSE = matchMedia('(pointer: coarse)').matches; } catch (e) { /* */ }
  const CFG = {
    google: qs.get('google') !== '0',
    // two stacked panoramas (cross-fade + preload) on desktop; one on touch devices unless the host asks for two
    buffer: qs.get('buffer') === '1' ? 1 : qs.get('buffer') === '2' ? 2 : (COARSE ? 1 : 2),
    period: { 1: 1200, 2: 1000 },  // ms per step at x1 / x2
    stride: { 1: 1, 2: 2 },        // x2 walks every other pano (twice the distance per step, the preload keeps ~1 s)
    fade: { 1: 520, 2: 380 },      // the cross-fade into the preloaded next step (inside the period)
    soft: { 1: 760, 2: 560 },      // ... and where the capture changes (another year's photos): a slower dissolve
    settle: { 1: 240, 2: 160 },    // a pano that just reported OK gets this long for its first tiles before it is shown
    turnSlow: 45, turnFactor: 1.6, // a turn of more than 45 degrees stays 1.6x longer
    longStep: 20, longFactor: 1.25,// so does a step of more than 20 m (x stride)
    maxTurn: { 1: 60, 2: 40 }, accel: 120, // deg/s at x1 / x2 (review R6: at x2 no turn is faster than 40), deg/s^2
    afterBeatTurn: 35,             // deg/s: from the marina view back to the quay (review R6)
    // the opening (review R2): a moment on the building view, then ONE slow dissolve straight into the street - no
    // whip-turn; the walk starts at chain[1] when the building view is practically chain[0] (within nearStart m)
    introHold: 900, nearStart: 6,
    // first paint (real-imagery review 2026-11-02): a panorama reports OK before its first tiles arrive and is a black
    // canvas until they do. The opening waits for paintTiles tiles of its pano before the page is shown, a step before
    // it fades in (a hold, like a slow load); at most paintWait ms, then it goes on as before (a real run on a slow
    // network still faded into black after 3 s: a step now waits as long as a load may take)
    paintTiles: 3, paintWait: { boot: 2500, step: 8000, cap: 20000, seen: 400, home: 2500 }, // (cap: with NO tile in after
    // `step`, keep the current picture and the hold ring until the first one - a degraded link once gave 0 tiles in 8 s;
    // never fade into black. seen: a pano this layer has drawn before in this page - the panorama may draw it from its own
    // cache without a request, so its wait is short. It was 2500: on the fix2 route (38 steps, fewer panos between the
    // first tour and a replay) an x2 replay waited the whole 2.5 s on 7 such steps with 0-2 new tiles, 0 black frames.
    // fix3: 400 (was 700): the real x2 replay still waited the whole 0.7 s on 5 steps (0 black frames in both runs)
    // home: the building view coming back, as before)
    loadTimeout: 8000, startCheck: 2500, bootTimeout: 15000,
    // the small loading ring beside the metres: only when a step has waited this long for its picture (verify review,
    // real imagery: most street steps wait 0.3-2 s for their first tiles - a ring on every step read as "stuck")
    ringAfter: 1200,
    // the countdown (fix2 review: with a fast Google it started ~20 s high, then dropped quickly). holdPrior: the wait
    // per step the plan assumes before this session's steps have shown their own. Seven real runs waited 31 / 11 / 30 /
    // 279 / 312 / 616 / 854 ms a step on average, and in the same order the first step's panorama took 205 / 262 / 272 /
    // 287 / 310 / 451 / 541 ms to answer (it loads during the opening): the prior is k x (that - base), within [min, max]
    // (5 s or less over a 38-step tour for all seven), and dflt when there is no such answer. etaSlew: how far the readout may run off the clock's pace to catch up a re-plan,
    // from [0] while the gap is small to [1] when the gap is large next to the time left (0.25 / 0.6: it always counts
    // down at 0.4x-1.6x real time, never jumps and never climbs; a speed change by the viewer re-plans at once)
    // (fix3: the readout catches a re-plan faster - rate 3 x gap / time left, at most 0.6 - and the prior is worth 2 steps,
    // not 3: in the mock a wrong first guess of ~17 s took most of the tour to work off, median error 8 s)
    holdPrior: { k: 3, base: 240, min: 50, max: 900, dflt: 250, weight: 2 }, etaSlew: [0.25, 0.6, 3],
    // a step longer than this (m) dissolves slowly, like a change of capture (fix3: skipped panos leave 49-81 m steps)
    softStep: 40,
  };
  const CANCEL = { cancelled: true };
  const S = window.__tour = {
    version: 'proto-3', mode: CFG.google ? 'google' : 'dry', buffer: CFG.buffer, embed: EMBED, autoplay: AUTOPLAY, lang: LANG,
    state: 'boot', i: -1, n: 0, along: 0, speed: 1, paused: false, apiError: null, startPano: null, fading: null, clock: 0, eta: 0, etaShown: 0, etaReady: false, firstLoadMs: null, first: null,
    stats: { panoramaObjects: 0, mapObjects: 0, setPanoCalls: 0, metaCalls: 0, steps: 0, held: 0, holdMs: 0, readyMs: [], fallbacks: 0, skipped: 0, tours: 0, tourMs: [], fades: 0, softFades: 0, jank: { gaps100: 0, gaps250: 0, maxGap: 0 } },
    stepLog: [], events: [],
  };
  const ev = (s) => { S.events.push(Math.round(performance.now()) + ' ' + s); if (S.events.length > 300) S.events.shift(); };

  // ---------- words (Hebrew / English) ----------
  const iso = (x) => '⁨' + x + '⁩'; // a Latin pier letter inside Hebrew: isolated, so "C: 740" cannot flip
  const W = {
    he: {
      title: 'סיור למרינה · THE HARBOUR', brandSub: 'סיור למרינה · פיראוס', tour: 'סיור למרינה', loading: 'טוען את Street View…',
      ctaMeta: (w, m) => `המרינה ${w} מ׳ מהבניין · כ-${m} דק׳ הליכה`,
      dryBadge: 'הדגמת ממשק · בלי Google · אין כאן תמונות רחוב', dryCompass: 'כיוון המבט', miniAria: 'מפת המסלול', miniCredit: 'מסלול: © OpenStreetMap contributors',
      holdTitle: 'טוען את התמונה הבאה', tick: (w) => `המים · ${w} מ׳`, endA: 'קונטוריוטו 161', endB: (p) => `מזח ${iso(p)}`,
      pause: 'השהיה', resume: 'המשך', speed: 'מהירות', exit: '✕ יציאה מהסיור', stop: '■ עצירה',
      pausedNote: 'מושהה · גררו כדי להסתכל מסביב · רווח להמשך', pausedNoteTouch: 'מושהה · גררו כדי להסתכל מסביב · הקישו להמשך',
      left: (m, s) => `כ-${m}:${s} לסיום`,
      metresFrom: (a) => `${a} מ׳ מהבניין`,
      arrH: (w) => `המרינה ${w} מ׳ מהבניין`, arrP: (m) => `כ-${m} דק׳ הליכה · מרינת זאה (ZEA)`, arrSmall: (p, m) => `עד מזח ${iso(p)}: ${m} מ׳`,
      again: '↺ שוב', home: 'חזרה לבניין', model: 'חזרה למודל', errEyebrow: 'Google Street View · נדרשת פעולה', retry: 'נסה שוב', dryLink: 'הדגמת הממשק – בלי Google',
    },
    en: {
      title: 'Marina tour · THE HARBOUR', brandSub: 'Marina tour · Piraeus', tour: 'Marina tour', loading: 'Loading Street View…',
      ctaMeta: (w, m) => `The marina is ${w} m from the building · about ${m} min on foot`,
      dryBadge: 'UI demo · no Google · no street imagery', dryCompass: 'view direction', miniAria: 'Route map', miniCredit: 'Route: © OpenStreetMap contributors',
      holdTitle: 'Loading the next view', tick: (w) => `water · ${w} m`, endA: 'Kountouriotou 161', endB: (p) => `Pier ${p}`,
      pause: 'Pause', resume: 'Resume', speed: 'Speed', exit: '✕ Exit tour', stop: '■ Stop',
      pausedNote: 'Paused · drag to look around · Space to go on', pausedNoteTouch: 'Paused · drag to look around · tap to go on',
      left: (m, s) => `about ${m}:${s} left`,
      metresFrom: (a) => `${a} m from the building`,
      arrH: (w) => `The marina, ${w} m from the building`, arrP: (m) => `About ${m} min on foot · Zea Marina`, arrSmall: (p, m) => `To pier ${p}: ${m} m`,
      again: '↺ Again', home: 'Back to the building', model: 'Back to the model', errEyebrow: 'Google Street View · action needed', retry: 'Try again', dryLink: 'UI demo – no Google',
    },
  }[LANG];
  // in the app the overlay's own "✕ חזרה למודל" is the way out: the HUD button only stops the walk (back to the
  // building view inside the overlay), so it says so and carries no second ✕ (review R4)
  if (EMBED) W.exit = W.stop;
  // a phone / iPad has no Space key (review R8)
  if (COARSE) W.pausedNote = W.pausedNoteTouch;

  // ---------- geometry ----------
  const rad = Math.PI / 180, ER = 6371008.8;
  const dist = (a, b) => Math.hypot((b[1] - a[1]) * rad * Math.cos((a[0] + b[0]) / 2 * rad), (b[0] - a[0]) * rad) * ER;
  const bearing = (a, b) => { const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad); const x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad); return (Math.atan2(y, x) / rad + 360) % 360; };
  const norm = (h) => ((h % 360) + 360) % 360;
  const sdelta = (from, to) => ((((to - from) % 360) + 540) % 360) - 180; // shortest signed turn from -> to
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const cmean = (pairs) => { let x = 0, y = 0; for (const [h, w] of pairs) { x += Math.cos(h * rad) * w; y += Math.sin(h * rad) * w; } return norm(Math.atan2(y, x) / rad); };
  const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('timeout: ' + what)), ms))]);

  // ---------- data (tour.json) ----------
  let T, chain, n, LINE, CUM;
  const toLine = (a) => { const m = T.alongMap; for (let k = 1; k < m.length; k++) { const [a0, b0] = m[k - 1], [a1, b1] = m[k]; if (a <= a1 || k === m.length - 1) return b0 + (b1 - b0) * clamp((a - a0) / Math.max(1e-6, a1 - a0), 0, 1); } return 0; };
  const pointAt = (b) => { b = clamp(b, 0, CUM[CUM.length - 1]); let k = 1; while (k < CUM.length - 1 && CUM[k] < b) k++; const t = (b - CUM[k - 1]) / Math.max(1e-6, CUM[k] - CUM[k - 1]); return [LINE[k - 1][0] + (LINE[k][0] - LINE[k - 1][0]) * t, LINE[k - 1][1] + (LINE[k][1] - LINE[k - 1][1]) * t]; };
  const posOSM = (i) => pointAt(toLine(chain[i].along));

  // ---------- Street View metadata, memory only ----------
  let SV = null, svc = null;
  const META = new Map(), META_NOW = new Map();
  const metaOf = (data) => ({ pos: [data.location.latLng.lat(), data.location.latLng.lng()], links: (data.links || []).map((l) => ({ pano: l.pano, heading: l.heading })), ym: data.imageDate ? String(data.imageDate).slice(0, 7) : null });
  function meta(id) {
    if (!svc) return Promise.resolve(null);
    if (META.has(id)) return META.get(id);
    S.stats.metaCalls++;
    const p = withTimeout(svc.getPanorama({ pano: id }), 6000, 'meta')
      .then(({ data }) => metaOf(data))
      .catch(() => null)
      .then((m) => { META_NOW.set(id, m); return m; });
    META.set(id, p);
    return p;
  }
  // the metadata of the next k steps (positions + links for the heading), asked a few steps before they are needed
  const lookAhead = (i0, k) => { for (let j = Math.max(0, i0); j < Math.min(n, i0 + k); j++) meta(chain[j].pano); };
  const pos = (i) => { const m = META_NOW.get(chain[i].pano); return (m && m.pos) || posOSM(i); };
  // another capture (a different year's photos) between two panos: dissolve slowly there
  const months = (ym) => (ym ? (+ym.slice(0, 4)) * 12 + (+ym.slice(5, 7)) : NaN);
  const captureChange = (a, b) => { const x = META_NOW.get(a), y = META_NOW.get(b); return !!(x && y && x.ym && y.ym && Math.abs(months(x.ym) - months(y.ym)) > 1); };

  // the direction of travel at step i: toward the next pano (its own link heading when Google has one), smoothed by
  // looking 2-3 steps ahead; the last step faces the basin
  function travelHeading(i) {
    if (i >= n - 1) return bearing(pos(n - 1), T.basin);
    const p = pos(i), w = [0.5, 0.3, 0.2], pairs = [];
    for (let k = 1; k <= 3; k++) {
      const j = Math.min(n - 1, i + k); if (j === i) continue;
      let h = bearing(p, pos(j));
      if (k === 1) { const m = META_NOW.get(chain[i].pano); const l = m && m.links.find((x) => x.pano === chain[j].pano); if (l && Number.isFinite(l.heading)) h = l.heading; }
      pairs.push([h, w[k - 1]]);
    }
    return cmean(pairs);
  }
  // where the camera looks at step i: the travel direction, but along the quay (review M2) turned quayK of the way
  // toward the basin, so the berths and the yachts stay in the picture; on the last stretch before the 290 m beat
  // (review R6) revealK of the way, so the camera holds near the water instead of following every jog of the street
  // (the reveal blend eases in over the 3 steps before revealFrom, so it never turns the camera at once)
  // per-pano overrides from the real-imagery review (2026-11-02), keyed by pano ID (tour.json look.panos):
  //   skip - never stop on it (a utility box or a pier gate right in front of the quay view); the walk takes the next pano
  //   k    - the quay blend there (by the rowing club its wall stands between the quay and the water: look down the quay)
  const panoOf = (i) => ((T.look && T.look.panos) || {})[chain[i].pano] || null; // (T arrives after this code is set up)
  const panoK = (i) => { const o = panoOf(i); return o && Number.isFinite(o.k) ? o.k : null; };
  const panoSkip = (i) => !!(panoOf(i) && panoOf(i).skip);
  const lookK = (i) => (panoK(i) != null ? panoK(i) : i >= T.look.quayFrom ? T.look.quayK : T.look.revealFrom == null ? 0 : (T.look.revealK || 0) * clamp((i - T.look.revealFrom + 3) / 3, 0, 1));
  //   dh   - degrees added to the look there (fix3: a person, bins or a tag at the edge of the frame turned out of it)
  function lookHeading(i) {
    const tr = travelHeading(i);
    const k = i >= n - 1 ? 0 : lookK(i);
    const o = panoOf(i), dh = o && Number.isFinite(o.dh) ? o.dh : 0;
    return norm((k ? tr + k * sdelta(tr, bearing(pos(i), T.basin)) : tr) + dh);
  }
  const pitchFor = (i) => (i >= T.look.quayFrom ? (T.look.quayPitch || 0) : 0);
  // (for the verifier: the three directions at step i)
  S.headings = (i) => ({ i, travel: Math.round(travelHeading(i)), look: Math.round(lookHeading(i)), basin: Math.round(bearing(pos(i), T.basin)) });
  // the next step: every pano at x1, every other at x2; along the quay every 2nd at x1 and every 3rd at x2
  // (review R5) - but never past the 290 m beat or the last pano
  const strideAt = (i, speed = S.speed) => (i >= T.look.quayFrom && T.look.quayStride ? T.look.quayStride[speed - 1] : CFG.stride[speed]);
  // a skipped pano: the walk takes the next one that is not (fix2: three skipped in a row before the reveal), never past
  // the beat or the last pano; when there is none, the one before it (after i)
  function nextIndex(i, speed = S.speed) {
    let j = Math.min(n - 1, i + strideAt(i, speed));
    if (i < T.beat.index && j > T.beat.index) j = T.beat.index;
    if (j < n - 1 && j !== T.beat.index && panoSkip(j)) {
      const lim = i < T.beat.index ? T.beat.index : n - 1;
      let k = j + 1; while (k < lim && panoSkip(k)) k++;
      if (k <= lim && !panoSkip(k)) j = k;
      else { k = j - 1; while (k > i && panoSkip(k)) k--; if (k > i) j = k; }
    }
    return j;
  }

  // ---------- camera: eased heading (accelerate, cruise at <= 60 deg/s, brake to stop on the target) + eased zoom ----------
  const cam = { h: 0, p: 0, z: 0, vh: 0, vp: 0, th: 0, tp: 0, tz: 0, drive: false, max: Infinity, spin: null, ah: NaN, ap: NaN, az: NaN };
  const settled = () => Math.abs(sdelta(cam.h, cam.th)) < 2.5 && Math.abs(cam.vh) < 8 && Math.abs(cam.tp - cam.p) < 1.5;
  // the 360 at the arrival (review R5): a trapezoid - ramp up for rampMs, a constant speed, ramp down for rampMs
  const spinMsFor = (speed) => { const v = T.arrival.spin.speed[speed - 1], r = T.arrival.spin.rampMs / 1000; return Math.round((360 / v + r) * 1000); };
  function spinAngle(sp, el) {
    const t = el / 1000, Tt = sp.ms / 1000, r = Math.min(sp.r, Tt / 2), v = 360 / (Tt - r);
    if (t <= 0) return 0;
    if (t >= Tt) return 360;
    if (t < r) return 0.5 * v / r * t * t;
    if (t > Tt - r) return 360 - 0.5 * v / r * (Tt - t) * (Tt - t);
    return v * r / 2 + v * (t - r);
  }
  function camStep(dt) {
    cam.z += (cam.tz - cam.z) * Math.min(1, dt * 2.2); if (Math.abs(cam.tz - cam.z) < 0.003) cam.z = cam.tz;
    if (cam.spin) {
      cam.spin.el += dt * 1000;
      cam.h = norm(cam.spin.h0 + spinAngle(cam.spin, cam.spin.el)); cam.vh = 0;
      cam.p += (cam.tp - cam.p) * Math.min(1, dt * 2);
      if (cam.spin.el >= cam.spin.ms) cam.spin.done = true;
      return;
    }
    const e = sdelta(cam.h, cam.th);
    const mx = Math.min(cam.max, CFG.maxTurn[S.speed]);
    const want = clamp(Math.sign(e) * Math.sqrt(2 * CFG.accel * Math.abs(e)), -mx, mx);
    cam.vh += clamp(want - cam.vh, -CFG.accel * dt, CFG.accel * dt);
    cam.h = norm(cam.h + cam.vh * dt);
    if (Math.abs(e) < 0.05 && Math.abs(cam.vh) < 1) { cam.h = cam.th; cam.vh = 0; }
    const ep = cam.tp - cam.p;
    const wantP = clamp(Math.sign(ep) * Math.sqrt(2 * 40 * Math.abs(ep)), -20, 20);
    cam.vp += clamp(wantP - cam.vp, -40 * dt, 40 * dt);
    cam.p += cam.vp * dt;
    if (Math.abs(ep) < 0.05 && Math.abs(cam.vp) < 1) { cam.p = cam.tp; cam.vp = 0; }
  }

  // ---------- first paint: which panoramas have their first tiles in ----------
  // Resource Timing names the tile requests of the page; only the pano ID is read from them, counted in memory for this
  // page (nothing Google returns is kept). Without Resource Timing the gates below are skipped (the settle time stays).
  const TILES = new Map();
  let tilesSeen = false;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name.indexOf('streetviewpixels') < 0 && e.name.indexOf('/cbk?') < 0) continue;
        const m = /[?&]panoid=([^&]+)/.exec(e.name); if (!m) continue;
        let id = m[1]; try { id = decodeURIComponent(id); } catch (x) { /* */ }
        tilesSeen = true; TILES.set(id, (TILES.get(id) || 0) + 1);
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (e) { /* (no PerformanceObserver: no gate) */ }
  S.tilesOf = (id) => TILES.get(id) || 0;
  // tiles of pano id that came in since `layer` was set to it: a pano the other layer showed earlier in this page (the
  // way home, a replay) has old counts - only new ones say THIS layer can draw it (a real run faded home into black)
  const newTiles = (layer, id) => (TILES.get(id) || 0) - (layer.tileBase && layer.tileBase.id === id ? layer.tileBase.n : 0);
  const twoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // waits until `layer` can draw pano id: new to this page -> paintTiles new tiles within paintWait.step, then (with none
  // at all) the first one within paintWait.cap; shown before -> paintTiles new ones within paintWait.seen
  async function paintGate(layer, id, seenMs = CFG.paintWait.seen) {
    if (!tilesSeen || newTiles(layer, id) >= CFG.paintTiles) return { ok: true, ms: 0 };
    // "shown before" means drawn by THIS layer (verify review: the way home on layer B faded into a black building
    // view the start had drawn on layer A - tiles another panorama fetched are no proof this one can draw them)
    const seen = !!(layer.drawn && layer.drawn.has(id));
    const t0 = performance.now();
    const upTo = async (need, ms) => { const end = performance.now() + ms; while (performance.now() < end) { if (newTiles(layer, id) >= need) { await twoFrames(); return true; } await sleepReal(40); } return false; };
    let ok = await upTo(CFG.paintTiles, seen ? seenMs : CFG.paintWait.step);
    if (!ok && !seen && newTiles(layer, id) < 1) ok = await upTo(1, CFG.paintWait.cap - CFG.paintWait.step);
    return { ok, ms: performance.now() - t0 };
  }
  // true once `need` tiles of pano id are in and two frames have drawn them; false after maxMs
  function tilesIn(id, need, maxMs) {
    const t0 = performance.now();
    return new Promise((res) => {
      (function tick() {
        if ((TILES.get(id) || 0) >= need) { requestAnimationFrame(() => requestAnimationFrame(() => res(true))); return; }
        if (performance.now() - t0 >= maxMs) { res(false); return; }
        setTimeout(tick, 40);
      })();
    });
  }

  // ---------- the two panorama layers ----------
  // drawn: the pano IDs each layer has put on screen this page (in memory; for the paint gate and for which layer
  // takes a pano again - the way home, a replay)
  const LA = { name: 'A', el: $('svA'), pano: null, id: null, drawn: new Set() };
  const LB = { name: 'B', el: $('svB'), pano: null, id: null, drawn: new Set() };
  // a pano the other layer drew and this one never did: on real imagery that once stayed black for seconds (the way
  // home on layer B) - such a pano goes back on the layer that drew it, or the walk takes the pano beside it
  const crossLayer = (layer, id) => { const other = layer === LA ? LB : LA; return !!id && other.drawn.has(id) && !layer.drawn.has(id); };
  let top = LA, under = LB, preload = null, fadePush = null, fadingP = null;
  S.view = () => ({ top: top.name, topPano: top.id, under: under.name, underPano: under.id, heading: Math.round(cam.h), pitch: Math.round(cam.p * 10) / 10, zoom: Math.round(cam.z * 100) / 100 });
  const OPT_BASE = { addressControl: false, fullscreenControl: false, motionTracking: false, motionTrackingControl: false, enableCloseButton: false, showRoadLabels: false, panControl: false };
  const OPT_FREE = { ...OPT_BASE, disableDefaultUI: false, linksControl: true, clickToGo: true, zoomControl: true, scrollwheel: true, keyboardShortcuts: true };
  // during the tour Google's own keys (arrows, +/-) would fight the automatic camera (review M10)
  const OPT_TOUR = { ...OPT_BASE, disableDefaultUI: true, linksControl: false, clickToGo: false, zoomControl: false, scrollwheel: false, keyboardShortcuts: false };

  function createPano(layer, id, pov, opts, zoom) {
    S.stats.panoramaObjects++;
    ev('panorama object ' + layer.name + ' (' + S.stats.panoramaObjects + ')');
    layer.tileBase = { id, n: TILES.get(id) || 0 };
    layer.pano = new SV.StreetViewPanorama(layer.el, { ...opts, pano: id, pov: { heading: pov.heading, pitch: pov.pitch }, zoom, visible: true });
    layer.pano.addListener('pano_changed', () => { if (S.state === 'ready') layer.id = layer.pano.getPano(); }); // walking with the arrows
    return layer.pano;
  }

  // resolves when the layer shows `id` (status OK and the new location arrived), or on failure / timeout
  function loadInto(layer, id, pov, set = true) {
    return new Promise((resolve) => {
      const p = layer.pano, t0 = performance.now();
      if (set && layer.id === id && p.getStatus() === 'OK') { if (pov) p.setPov(pov); resolve({ ok: true, ms: 0, at: t0 - 1e4 }); return; }
      const prevLoc = set ? ((p.getLocation() || {}).pano || null) : null;
      // a failed load leaves its status (ZERO_RESULTS) on the panorama until the next load answers: a non-OK status
      // only counts when a status_changed arrives after our setPano, never the stale one
      let saw = !set, sawStatus = !set, done = false;
      const fin = (ok, why) => {
        if (done) return; done = true; clearInterval(iv); clearTimeout(to); ls.forEach((l) => l.remove());
        layer.id = ok ? ((p.getLocation() || {}).pano || id) : null;
        resolve({ ok, why, ms: Math.round(performance.now() - t0), at: performance.now() });
      };
      const check = () => {
        if (!saw) return;
        const st = p.getStatus(), loc = p.getLocation();
        if (st && st !== 'OK') { if (sawStatus) fin(false, st); return; }
        if (st === 'OK' && loc && (loc.pano === id || !set || (prevLoc && loc.pano !== prevLoc))) fin(true);
      };
      const ls = ['status_changed', 'position_changed', 'pano_changed'].map((e) => p.addListener(e, () => { saw = true; if (e === 'status_changed') sawStatus = true; check(); }));
      const iv = setInterval(check, 80);
      const to = setTimeout(() => fin(false, 'timeout'), CFG.loadTimeout);
      if (set) { if (pov) p.setPov(pov); S.stats.setPanoCalls++; layer.tileBase = { id, n: TILES.get(id) || 0 }; p.setPano(id); }
    });
  }

  function startPreload(i, idOverride, pov, zoom) {
    const id = idOverride || chain[i].pano;
    const pre = { i, id, done: null, t0: performance.now() };
    try { under.pano.setZoom(zoom != null ? zoom : cam.tz); } catch (e) { /* */ }
    pre.promise = loadInto(under, id, pov || { heading: cam.th, pitch: cam.tp }).then((r) => { pre.done = r; S.stats.readyMs.push(r.ms); return r; });
    preload = pre;
    return pre;
  }

  // the top layer fades out (pushing forward a little with the panorama's own zoom) onto the preloaded layer below.
  // freeze (the opening dissolve): the outgoing building view keeps its own heading / zoom while the camera already
  // stands in the street on the layer below
  function crossFade(soft, freeze) {
    const out = top, inn = under, ms = (soft ? CFG.soft : CFG.fade)[S.speed];
    let z0 = cam.z; if (freeze) { try { z0 = out.pano.getZoom(); } catch (e) { /* */ } if (!Number.isFinite(z0)) z0 = T.start.zoom; }
    fadingP = (async () => {
      inn.pano.setPov({ heading: cam.h, pitch: cam.p });
      try { inn.pano.setZoom(cam.z); } catch (e) { /* */ }
      out.el.style.setProperty('--fade', ms + 'ms');
      fadePush = { out, inn, t0: performance.now(), ms, z0, freeze: !!freeze, push: soft ? T.look.push * 0.5 : T.look.push };
      S.fading = { t0: Math.round(performance.now()), ms, soft: !!soft };
      void out.el.offsetWidth;
      out.el.classList.add('fading');
      await sleepReal(ms + 40);
      fadePush = null; S.fading = null;
      inn.el.style.zIndex = '2'; out.el.style.zIndex = '1';
      out.el.classList.remove('fading');
      try { out.pano.setZoom(cam.z); out.pano.setPov({ heading: cam.h, pitch: cam.p }); } catch (e) { /* */ }
      top = inn; under = out; cam.ah = NaN; cam.az = NaN;
      if (inn.id) inn.drawn.add(inn.id);
      S.stats.fades++; if (soft) S.stats.softFades++;
    })();
    return fadingP.finally(() => { fadingP = null; });
  }

  async function fallbackId(i) {
    if (!svc) return null;
    try {
      const p = posOSM(i);
      const { data } = await withTimeout(svc.getPanorama({ location: { lat: p[0], lng: p[1] }, radius: 25, sources: [SV.StreetViewSource.GOOGLE] }), 6000, 'fallback');
      S.stats.fallbacks++; ev('fallback at step ' + i);
      return data.location.pano;
    } catch (e) { return null; }
  }

  // one panorama (?buffer=1, touch devices): the opening dips the picture to the page colour and back instead
  const stageEl = $('stage');
  async function dip(on) {
    if (on) { stageEl.classList.add('dipping'); void stageEl.offsetWidth; stageEl.classList.add('dip'); await sleepReal(360); }
    else { stageEl.classList.remove('dip'); setTimeout(() => stageEl.classList.remove('dipping'), 520); }
  }

  // make step i the visible one; returns the ms the walk waited for its picture (0 when it was ready).
  // intro: the opening step (review R2) - the camera is set to stand in the street, looking down the route, the moment
  // the slow dissolve from the building view begins (no turn on screen)
  async function showStep(i, tok, intro) {
    const id = chain[i].pano;
    const aim = () => { if (!intro) return; cam.h = cam.th = lookHeading(i); cam.p = cam.tp = pitchFor(i); cam.vh = cam.vp = 0; cam.z = cam.tz = T.look.walkZoom; };
    if (S.mode === 'dry') {
      // the stand-in for a preloaded pano: only the cross-fade time (the load happened during the previous step)
      S.stats.readyMs.push(140 + ((i * 53) % 260));
      if (intro) { S.fading = { t0: Math.round(performance.now()), ms: CFG.soft[S.speed], soft: true }; aim(); }
      await sleepReal((intro ? CFG.soft : CFG.fade)[S.speed]);
      S.fading = null;
      if (tok.cancelled) throw CANCEL;
      top.id = id; dryPulse(); return { held: 0, soft: !!intro };
    }
    if (top.id === id) { aim(); return { held: 0, soft: false }; }
    const soft = !!intro || captureChange(top.id, id) || (S.i >= 0 && chain[i].along - chain[S.i].along > CFG.softStep);
    if (CFG.buffer === 1) {
      const t0 = performance.now();
      if (intro) { await dip(true); aim(); try { top.pano.setZoom(cam.z); } catch (e) { /* */ } }
      const pov = intro ? { heading: cam.h, pitch: cam.p } : null;
      let r = await loadInto(top, id, pov);
      if (!r.ok) { const alt = await fallbackId(i); r = alt ? await loadInto(top, alt, pov) : r; }
      if (intro) { await sleepReal(CFG.settle[S.speed]); dip(false); }
      if (tok.cancelled) throw CANCEL;
      if (!intro) S.stats.readyMs.push(Math.round(performance.now() - t0)); // (the opening's dip is not a step's load)
      if (!r.ok) { S.stats.skipped++; ev('skipped ' + i); return { held: 0, soft, skipped: true }; }
      if (top.id) top.drawn.add(top.id);
      return { held: 0, soft };
    }
    const pre = preload && preload.i === i ? preload : startPreload(i);
    let r = pre.done, held = 0;
    // (one hold from the wait for Google's answer through the wait for the first tiles: the ring and the countdown see
    // one wait, not two)
    if (!r) {
      const t0 = performance.now(); setHold(true);
      r = await pre.promise;
      held = performance.now() - t0; if (held > 60) { S.stats.held++; S.stats.holdMs += Math.round(held); }
    }
    if (tok.cancelled) throw CANCEL;
    if (!r.ok) {
      const alt = await fallbackId(i);
      if (tok.cancelled) throw CANCEL;
      if (!alt) { setHold(false); S.stats.skipped++; ev('skipped ' + i); return { held, soft, skipped: true }; }
      r = await startPreload(i, alt).promise;
      if (tok.cancelled) throw CANCEL;
      if (!r.ok) { setHold(false); S.stats.skipped++; ev('skipped ' + i); return { held, soft, skipped: true }; }
    }
    // (the settle time stands in for the first tiles only where the page cannot count them)
    const since = performance.now() - r.at;
    if (!tilesSeen && since < CFG.settle[S.speed]) await sleepReal(CFG.settle[S.speed] - since);
    if (tok.cancelled) throw CANCEL;
    // its first tiles must be in before it fades in: under a slow Google answer a short hold, never a black picture
    const pid = under.id || id;
    if (tilesSeen && newTiles(under, pid) < CFG.paintTiles) {
      setHold(true);
      const g = await paintGate(under, pid);
      held += g.ms;
      if (g.ms > 60) { S.stats.held++; S.stats.holdMs += Math.round(g.ms); }
      S.stats.paintHolds = (S.stats.paintHolds || 0) + 1; if (!g.ok) { S.stats.paintTimeouts = (S.stats.paintTimeouts || 0) + 1; ev('paint timeout ' + i + ' (tiles ' + newTiles(under, pid) + (crossLayer(under, pid) ? ', cross-layer' : '') + ')'); }
      if (tok.cancelled) throw CANCEL;
    }
    setHold(false);
    const tiles = newTiles(under, pid);
    aim();
    await crossFade(soft, !!intro);
    return { held: Math.round(held), soft, tiles };
  }

  // back to the view at the building (today's app view: heading 44.2, pitch 11.2, zoom 0.78 - the owner's embed)
  async function homeView() {
    const pov = { heading: T.start.heading, pitch: T.start.pitch };
    cam.z = cam.tz = T.start.zoom;
    if (S.mode === 'google') {
      if (fadingP) await fadingP;
      if (preload && !preload.done) await Promise.race([preload.promise, sleepReal(4000)]);
      preload = null;
      if (top.id !== S.startPano) {
        // the building view comes back on the layer that drew it at the start (layer A): from below with the usual
        // dissolve, or - when that layer is the one on top - with a short dip to the page colour while it reloads
        // (verify review: brought back on layer B it stayed black in a real run)
        const homeL = CFG.buffer === 2 && under.pano && crossLayer(under, S.startPano) ? top : under;
        if (CFG.buffer === 2 && under.pano && homeL === under) {
          const r = await loadInto(under, S.startPano, pov);
          if (r.ok) { const g = await paintGate(under, under.id || S.startPano, CFG.paintWait.home); ev('home on ' + under.name + ' (dissolve) tiles ' + newTiles(under, under.id || S.startPano) + (g.ok ? '' : ' timeout') + ' +' + Math.round(g.ms) + ' ms'); await crossFade(true); }
        } else if (CFG.buffer === 2 && under.pano) {
          await dip(true);
          try { top.pano.setZoom(T.start.zoom); } catch (e) { /* */ }
          const r = await loadInto(top, S.startPano, pov);
          // (a short wait: this layer drew the building before, and the page colour stands in for the picture meanwhile)
          if (r.ok) { const g = await paintGate(top, top.id || S.startPano, 2000); ev('home on ' + top.name + ' (dip) tiles ' + newTiles(top, top.id || S.startPano) + (g.ok ? '' : ' timeout') + ' +' + Math.round(g.ms) + ' ms'); }
          dip(false);
        } else await loadInto(top, S.startPano, pov);
      }
      top.pano.setPov(pov); try { top.pano.setZoom(T.start.zoom); } catch (e) { /* */ }
    } else top.id = S.startPano;
    cam.h = cam.th = pov.heading; cam.p = cam.tp = pov.pitch; cam.vh = cam.vp = 0; cam.ah = NaN; cam.az = NaN;
  }

  // ---------- clocks (tour time stands still while paused) ----------
  function wait(ms, tok) {
    return new Promise((res, rej) => {
      let left = ms, last = performance.now();
      (function tick() {
        if (tok.cancelled) { rej(CANCEL); return; }
        const t = performance.now(); if (!S.paused) left -= t - last; last = t;
        if (left <= 0) { res(); return; }
        setTimeout(tick, Math.min(40, Math.max(4, left)));
      })();
    });
  }
  function until(fn, tok, maxMs) {
    return new Promise((res, rej) => {
      let spent = 0, last = performance.now();
      (function tick() {
        if (tok.cancelled) { rej(CANCEL); return; }
        const t = performance.now(); if (!S.paused) spent += t - last; last = t;
        let v = false; try { v = fn(); } catch (e) { /* */ }
        if (v || spent >= maxMs) { res(!!v); return; }
        setTimeout(tick, 30);
      })();
    });
  }

  // ---------- the tour ----------
  let run = null, tourT0 = 0;
  // the pano after step i goes on the layer below (the one not showing i). In a replay at another speed some panos were
  // drawn by the OTHER layer in the first tour; then the pano beside it is taken instead (never past the 290 m beat,
  // never instead of the beat or the last pano, never a skipped one) - see crossLayer(). The side alternates (one
  // step further, the next one step shorter), so the pace and the countdown stay those of the speed
  let swapSide = -1;
  function layerSafe(i, j) {
    if (!crossLayer(under, chain[j].pano) || j === T.beat.index || j === n - 1) return j;
    for (const k of swapSide < 0 ? [j + 1, j - 1] : [j - 1, j + 1]) {
      if (k <= i || k > n - 1 || (i < T.beat.index && k > T.beat.index) || panoSkip(k) || crossLayer(under, chain[k].pano)) continue;
      S.stats.layerSwaps = (S.stats.layerSwaps || 0) + 1; ev('layer-safe ' + j + ' -> ' + k); swapSide = k - j;
      return k;
    }
    return j;
  }

  // the step period at step i (heading th after prevH, next step j): turns and long steps stay longer
  function periodAt(i, j, prevH, th, speed) {
    let k = 1;
    if (Math.abs(sdelta(prevH, th)) > CFG.turnSlow) k *= CFG.turnFactor;
    if (j > i && chain[j].along - chain[i].along > CFG.longStep * strideAt(i, speed)) k *= CFG.longFactor;
    return CFG.period[speed] * k;
  }
  // where the walk starts: chain[1] when the building view is practically chain[0] (review R2: a 4 m first step
  // looked like no move at all)
  // (fix3: never a skipped pano - since fix3 the 10 m pano is skipped, so the walk opens on the 20 m one)
  const unskipped = (k) => { while (k < T.beat.index && panoSkip(k)) k++; return k; };
  function firstIndex() {
    if (S.mode !== 'google') return unskipped(chain[0].along <= CFG.nearStart ? 1 : 0);
    if (S.startPano === chain[0].pano) return unskipped(1);
    const a = META_NOW.get(S.startPano), b = META_NOW.get(chain[0].pano);
    if (a && b && a.pos && b.pos) return unskipped(dist(a.pos, b.pos) <= CFG.nearStart ? 1 : 0);
    return unskipped(chain[0].along <= CFG.nearStart ? 1 : 0); // (metadata not back yet: chain[0] is the pano at the building)
  }

  // ---------- the countdown (review R7): a plan of what is left, on the tour clock (it stands still while paused) ----------
  // the turns around the beat and before the 360, from their real angles (fix3: the 317 m reveal turns only ~5 degrees,
  // and a fixed 2.2 s for the beat's turns left the plan ~2 s high): the camera's own easing (accelerate at CFG.accel,
  // cruise at max, brake), never shorter than the pitch change it waits for (2 degrees at the beat, 5 at the arrival)
  const turnMs = (deg, max) => { const a = CFG.accel, d = Math.abs(deg); const t = d < 2.5 ? 0 : d <= max * max / a ? 2 * Math.sqrt(d / a) : d / max + max / a; return Math.round(t * 1000) + 150; };
  const pitchMs = (dp) => Math.round(2 * Math.sqrt(Math.abs(dp) / 40) * 1000) + 150; // (pitch: 40 deg/s^2, see camStep)
  const beatHeading = (i) => norm(bearing(pos(i), T.basin) + (T.beat.dh || 0));
  const beatTurns = (i, nx, th, speed) => { const bh = beatHeading(i); return Math.max(turnMs(sdelta(th, bh), CFG.maxTurn[speed]), pitchMs(2 - pitchFor(i))) + Math.max(turnMs(sdelta(bh, lookHeading(nx)), Math.min(CFG.afterBeatTurn, CFG.maxTurn[speed])), pitchMs(2 - pitchFor(nx))); };
  const arrivalTurn = (fromH) => Math.max(turnMs(sdelta(fromH, bearing(pos(n - 1), T.basin)), Math.min(CFG.afterBeatTurn, CFG.maxTurn[S.speed])), pitchMs(T.arrival.pitch - pitchFor(n - 1)));
  // with one panorama the load is not hidden under the previous step: add the typical load time of this session.
  // With two, the next step loads under the current one, but on real imagery its first tiles often come after the
  // step's own time (verify review: 0.3-2 s on the streets, a 2.0 s median step where 1.25 s was planned, and the
  // countdown 14 s short): plan with what this session's steps waited (HOLDS, zeros included, each counted up to
  // 1.2 s so one slow answer does not swing the plan), from a prior of CFG.holdPrior a step worth 3 steps (five real
  // runs averaged 0.03-0.85 s a step; the building view's paint time did not predict which). The prior was 450 ms: with
  // a fast Google the first readout was ~20 s high (fix2 review); the readout now also follows the plan at a limited
  // pace (showLeft), so whatever the first guess, it never drops quickly
  const HOLDS = [];
  const holdPrior = () => { const P = CFG.holdPrior; return S.firstLoadMs == null ? P.dflt : clamp(P.k * (S.firstLoadMs - P.base), P.min, P.max); };
  function stepOverhead() {
    if (S.mode !== 'google') return 40;
    if (CFG.buffer === 2) {
      const prior = tilesSeen ? holdPrior() : 0; // (no tile requests seen at all: no paint gate, so no waits to plan for)
      const r = HOLDS.slice(-12);
      const w = CFG.holdPrior.weight;
      return 40 + (prior * w + r.reduce((a, b) => a + Math.min(b, 1200), 0)) / (w + r.length);
    }
    // (the mean of the last 12 ordinary loads, held toward 450 ms by a prior worth 6 loads: the opening's dip or one
    // slow load must not swing a 40-step estimate by several seconds)
    const r = S.stats.readyMs.slice(-12).filter((x) => x < 1500);
    return (450 * 6 + r.reduce((a, b) => a + b, 0)) / (6 + r.length);
  }
  function planLeft(i, speed, beatDone, prevH) {
    let ms = 0, h = prevH;
    const over = stepOverhead();
    for (let j = i; j < n - 1;) {
      const nx = nextIndex(j, speed), th = lookHeading(j);
      ms += periodAt(j, nx, h, th, speed) + over; h = th;
      if (j === T.beat.index && !beatDone) ms += beatTurns(j, nx, th, speed) + T.beat.holdMs * (speed === 2 ? 0.7 : 1);
      j = nx;
    }
    return ms + arrivalTurn(lookHeading(n - 1)) + 400 + spinMsFor(speed);
  }
  let stepClock = 0;
  // S.eta is the plan (the tour-clock time the tour should end); S.etaShown is what the readout counts down to. smooth
  // (each step's re-plan, the arrival): the plan moves at once and the readout follows it at a limited pace (etaTick).
  // Not smooth (the start of a tour, a speed change by the viewer): the readout takes the plan at once
  function setEta(ms, smooth) {
    S.eta = S.clock + Math.max(0, ms);
    if (!smooth || !(S.etaShown > S.clock)) S.etaShown = S.eta;
    showLeft(true);
  }
  // per frame, on the tour clock (d ms): the readout's deadline moves toward the plan by at most rate x d, so the time
  // left counts down between (1 - rate) and (1 + rate) times real time. rate grows from etaSlew[0] to etaSlew[1] as the
  // gap gets large next to the time left, so it lands on the plan before the end
  function etaTick(d) {
    const g = S.eta - S.etaShown;
    if (!g) return;
    const left = Math.max(1000, S.etaShown - S.clock);
    const rate = clamp(CFG.etaSlew[2] * Math.abs(g) / left, CFG.etaSlew[0], CFG.etaSlew[1]); // (lands within about a third of the time left)
    S.etaShown += clamp(g, -rate * d, rate * d);
  }
  function replan() {
    if (S.state === 'arrival') return; // (the 360's length is fixed once it starts)
    if (S.i < 0) { setEta(Math.max(0, CFG.introHold - S.clock) + CFG.soft[S.speed] + 400 + planLeft(S.first == null ? firstIndex() : S.first, S.speed, false, cam.th)); return; }
    setEta(planLeft(S.i, S.speed, !!S.beatDone, cam.th) - (S.clock - stepClock));
  }
  let shownLeft = -1;
  function showLeft(force) {
    const el = $('hudTime');
    if (!touring() || !S.etaReady) return;
    const s = Math.max(0, Math.ceil((S.etaShown - S.clock) / 1000));
    if (s === shownLeft && !force) return;
    shownLeft = s; el.textContent = W.left(Math.floor(s / 60), String(s % 60).padStart(2, '0'));
  }

  async function runTour(tok) {
    const t0 = tourT0 = performance.now();
    S.state = 'playing'; S.i = -1; S.along = 0; S.stepLog = []; S.beatDone = false; S.clock = 0; ev('tour start');
    cam.drive = true; cam.th = cam.h; cam.tp = cam.p; cam.max = Infinity;
    setProgress(0, 0); updateHUD(0); miniTo(0, 0);
    const first = S.first = firstIndex();
    swapSide = -1;
    S.etaReady = false; $('hudTime').textContent = ''; shownLeft = -1; // (blank until the first estimate, below)
    // the street view the dissolve goes to: preloaded on the layer below from the first moment, already looking down the route
    const pov1 = { heading: lookHeading(first), pitch: pitchFor(first) };
    let pace = null;
    if (S.mode === 'google' && CFG.buffer === 2) {
      if (!under.pano) {
        // the second panorama is made on the first tour only (one more Dynamic Street View load), already on the first step
        createPano(under, chain[first].pano, pov1, OPT_TOUR, T.look.walkZoom);
        const pre = { i: first, id: chain[first].pano, done: null, t0: performance.now() };
        pre.promise = loadInto(under, chain[first].pano, null, false).then((r) => { pre.done = r; S.stats.readyMs.push(r.ms); if (S.firstLoadMs == null && r.ok) S.firstLoadMs = r.ms; return r; });
        preload = pre;
        // the first readout (fix2): how long this panorama takes to answer is this session's Google pace (CFG.holdPrior),
        // so the countdown appears once it has answered - at most the intro hold (a slower answer counts as that long)
        pace = Promise.race([pre.promise, sleepReal(CFG.introHold)]).then(() => { if (S.firstLoadMs == null) S.firstLoadMs = Math.round(performance.now() - pre.t0); });
      } else startPreload(first, null, pov1, T.look.walkZoom);
    }
    const firstEta = () => { if (run !== tok || tok.cancelled || S.etaReady) return; S.etaReady = true; replan(); };
    if (pace) pace.then(firstEta); else firstEta();
    // a moment on today's view (the building), then one slow dissolve into the street
    lookAhead(0, 5);
    await wait(CFG.introHold, tok);
    await Promise.race([Promise.all([0, 1, 2, 3].map((j) => meta(chain[Math.min(n - 1, first + j)].pano))), sleepReal(1200)]);
    let prevH = lookHeading(first), i = first;
    for (;;) {
      const st = await showStep(i, tok, i === first);
      if (tok.cancelled) throw CANCEL;
      S.i = i; S.along = chain[i].along; S.stats.steps++; stepClock = S.clock;
      S.stepLog.push({ i, t: Math.round(performance.now() - t0), held: st.held, soft: st.soft || undefined, skipped: st.skipped || undefined, x: S.speed, tiles: st.tiles });
      if (S.stepLog.length > 200) S.stepLog.shift();
      lookAhead(i + 1, 5);
      let j = i < n - 1 ? nextIndex(i) : i;
      if (S.mode === 'google' && CFG.buffer === 2 && j > i) j = layerSafe(i, j);
      HOLDS.push(st.held || 0); if (HOLDS.length > 40) HOLDS.shift();
      const th = lookHeading(i);
      const period = periodAt(i, j, prevH, th, S.speed);
      S.etaReady = true; setEta(planLeft(i, S.speed, S.beatDone, prevH), true);
      updateHUD(i); setProgress(chain[i].along, period); miniTo(chain[i].along, period);
      cam.th = th; cam.tp = pitchFor(i); prevH = th;
      if (S.mode === 'google' && CFG.buffer === 2 && j > i) startPreload(j);
      else if (S.mode === 'google') lookAhead(j, 1);
      if (i === T.beat.index) { await beat(i, j, tok); prevH = cam.th; }
      if (i === n - 1) break;
      const used = S.mode === 'dry' || CFG.buffer === 2 ? CFG.fade[S.speed] : 0; // the fade is part of the step
      await wait(Math.max(200, period - used), tok);
      i = j;
    }
    await arrival(tok);
    S.stats.tours++; S.stats.tourMs.push(Math.round(performance.now() - t0));
  }

  // the 290 m stop: face the basin, say it, then ease on toward the quay
  async function beat(i, j, tok) {
    ev('beat at ' + i); S.beatAt = Math.round(performance.now() - tourT0);
    showBeat(LANG === 'en' ? T.beat.captionEn : T.beat.caption);
    // (beat.dh: degrees right of the basin bearing - fix2, the 317 m reveal keeps a man at the edge of the quay out of frame)
    cam.th = beatHeading(i); cam.tp = 2;
    await until(settled, tok, 3500);
    S.beatFacing = true;
    await wait(T.beat.holdMs * (S.speed === 2 ? 0.7 : 1), tok);
    S.beatFacing = false; S.beatDone = true;
    hideBeat();
    // back to the quay framing of the next step, gently (review R6)
    cam.max = CFG.afterBeatTurn;
    cam.th = lookHeading(j); cam.tp = pitchFor(j);
    await until(settled, tok, 3000);
    cam.max = Infinity;
  }

  async function arrival(tok) {
    S.state = 'arrival'; ev('arrival');
    const i = n - 1;
    const spinMs = S.spinMs = spinMsFor(S.speed);
    setEta(arrivalTurn(cam.h) + 400 + spinMs, true);
    updateHUD(i, true); setProgress(T.metres, 600); miniTo(chain[i].along, 600);
    cam.max = CFG.afterBeatTurn; // (a calm turn to the basin, like after the beat)
    cam.th = bearing(pos(i), T.basin); cam.tp = T.arrival.pitch;
    await until(settled, tok, 4000);
    cam.max = Infinity;
    await wait(400, tok);
    // a slow 360 over the yachts: ramp up, a constant speed, ramp down (review R5)
    cam.spin = { h0: cam.h, ms: spinMs, r: T.arrival.spin.rampMs / 1000, el: 0, done: false };
    setEta(spinMs, true);
    S.spinning = true;
    await until(() => cam.spin && cam.spin.done, tok, spinMs + 6000);
    S.spinning = false;
    cam.spin = null; cam.th = cam.h; cam.vh = 0;
    cam.drive = false;
    S.state = 'done'; ev('done');
    $('hud').hidden = true;
    $('arrive').hidden = false;
  }

  async function startTour() {
    if (S.state !== 'ready' && S.state !== 'done') return;
    const tok = { cancelled: false }; run = tok;
    S.state = 'starting'; S.paused = false; pauseUI();
    $('cta').hidden = true; $('arrive').hidden = true; $('hud').hidden = false; $('mini').hidden = false;
    try {
      if (S.mode === 'google') {
        ensureMini().catch((e) => ev('mini-map failed: ' + (e && e.message)));
        if (top.id !== S.startPano) await homeView(); // explored with the arrows, or a replay: the building first
        [LA, LB].forEach((l) => l.pano && l.pano.setOptions(OPT_TOUR));
        const pv = top.pano.getPov(); cam.h = norm(pv.heading); cam.p = pv.pitch;
        cam.z = cam.tz = T.start.zoom; cam.az = NaN;
      } else { ensureMiniSvg(); if (top.id !== S.startPano) await homeView(); }
      if (tok.cancelled) return;
      await runTour(tok);
    } catch (e) {
      if (e !== CANCEL) { ev('tour error: ' + (e && e.message)); if (!S.apiError) goHome(); }
    }
  }

  let homing = false;
  async function goHome() {
    if (homing || S.state === 'boot' || S.state === 'api-error') return;
    homing = true;
    if (run) run.cancelled = true; run = null;
    cam.spin = null; cam.drive = false; S.paused = false; S.spinning = false; S.beatFacing = false; pauseUI(); hideBeat(); setHold(false);
    $('hud').hidden = true; $('arrive').hidden = true; $('mini').hidden = true;
    S.state = 'homing'; ev('home');
    try { await homeView(); } catch (e) { ev('home error: ' + (e && e.message)); }
    if (S.mode === 'google') [LA, LB].forEach((l) => l.pano && l.pano.setOptions(OPT_FREE));
    S.i = -1; S.along = 0;
    if (!S.apiError) { S.state = 'ready'; $('cta').hidden = false; }
    homing = false;
  }

  const touring = () => S.state === 'playing' || S.state === 'arrival';
  function setPaused(v, why) {
    if (!touring() || S.paused === v) return;
    S.paused = v; ev((v ? 'pause' : 'resume') + ' (' + why + ')');
    if (!v && S.mode === 'google' && top.pano) {
      // go on from wherever the viewer looked: the 360 re-bases on it, the walk eases back to the route
      const pv = top.pano.getPov(); cam.h = norm(pv.heading); cam.p = pv.pitch; cam.vh = cam.vp = 0; cam.ah = NaN;
      if (cam.spin) cam.spin.h0 = norm(cam.h - spinAngle(cam.spin, cam.spin.el));
    }
    pauseUI();
  }
  function pauseUI() {
    $('hud').classList.toggle('paused', S.paused);
    $('pausedNote').hidden = !S.paused;
    $('btnPause').setAttribute('aria-label', S.paused ? W.resume : W.pause);
  }
  function toggleSpeed() {
    S.speed = S.speed === 1 ? 2 : 1;
    const b = $('btnSpeed'); b.textContent = '×' + S.speed; b.classList.toggle('on', S.speed === 2);
    if (touring()) replan(); // (also before the first step - review R7)
    ev('speed x' + S.speed);
  }
  // the host (the app's overlay) follows the page: it shows the page once there is something to see, and hides its own
  // "✕ חזרה למודל" while the arrival card offers the same action (review R4)
  let postedState = '';
  function postState() {
    if (!EMBED || S.state === postedState) return;
    postedState = S.state;
    try { window.parent.postMessage({ type: 'maoz:marina-tour', state: S.state }, '*'); } catch (e) { /* */ }
  }
  function closeEmbed() { try { window.parent.postMessage({ type: 'maoz:marina-tour', action: 'close' }, '*'); } catch (e) { /* */ } }

  // ---------- HUD ----------
  const sectionAt = (a) => { let s = T.sections[0]; for (const x of T.sections) if (a >= x.from) s = x; return s; };
  const roundM = (m) => Math.round(m / 10) * 10;
  // one place at a time says "290" (review R3): the beat pill at the beat, the track tick all along; the HUD line only
  // counts the metres from the building (blank while the beat pill is up), and at the end says how far the pier is
  function updateHUD(i, arrived) {
    const a = chain[i].along, s = arrived ? T.sections[T.sections.length - 1] : sectionAt(a);
    const L = LANG === 'en' ? s.en : s;
    $('hudLabel').textContent = L.label; $('hudSub').textContent = arrived ? '' : L.sub;
    $('hudMetres').textContent = arrived ? W.metresFrom(roundM(T.metres)) : i === T.beat.index ? '' : W.metresFrom(a);
  }
  const SIDE = LANG === 'en' ? 'left' : 'right';
  function setProgress(a, ms) {
    const k = clamp(a / T.metres, 0, 1) * 100;
    $('hud').style.setProperty('--tw', Math.round(ms) + 'ms');
    // transform only (app integration, 2026-11-03): the fill scales from its start, the head's full-width run slides
    $('fill').style.transform = 'scaleX(' + (k / 100) + ')'; $('run').style.transform = 'translateX(' + (SIDE === 'right' ? -k : k) + '%)';
  }
  let holdOn = false, holdT0 = 0, holdExp = 0, ringTimer = 0;
  function setHold(v) {
    if (holdOn === v) return; holdOn = v; clearTimeout(ringTimer);
    if (v) { holdT0 = performance.now(); holdExp = Math.max(0, stepOverhead() - 40); ringTimer = setTimeout(() => { if (holdOn) $('hold').hidden = false; }, CFG.ringAfter); }
    else $('hold').hidden = true;
  }
  function showBeat(t) { const b = $('beat'); b.textContent = t; b.hidden = false; }
  function hideBeat() { $('beat').hidden = true; }

  // ---------- mini-map ----------
  const mini = { along: 0, from: 0, to: 0, t0: 0, ms: 1, last: 0 };
  function miniTo(a, ms) { mini.from = mini.along; mini.to = a; mini.t0 = performance.now(); mini.ms = Math.max(1, ms); }
  let gmini = null;
  async function ensureMini() {
    if (gmini) return;
    gmini = { pending: true };
    const { Map, Polyline, Circle } = await google.maps.importLibrary('maps');
    const { LatLngBounds } = await google.maps.importLibrary('core');
    const path = LINE.map((p) => ({ lat: p[0], lng: p[1] }));
    S.stats.mapObjects++; ev('map object');
    const map = new Map($('miniMap'), { center: path[Math.floor(path.length / 2)], zoom: 15, disableDefaultUI: true, gestureHandling: 'none', keyboardShortcuts: false, clickableIcons: false, backgroundColor: '#0d1f19', styles: MINI_STYLE });
    const b = new LatLngBounds(); path.forEach((p) => b.extend(p)); map.fitBounds(b, 16);
    new Polyline({ map, path, strokeColor: '#C8A96B', strokeOpacity: 0.95, strokeWeight: 4, clickable: false, zIndex: 1 });
    const done = new Polyline({ map, path: [path[0]], strokeColor: '#F0E9D8', strokeOpacity: 0.95, strokeWeight: 4, clickable: false, zIndex: 2 });
    new Circle({ map, center: path[0], radius: 9, fillColor: '#F0E9D8', fillOpacity: 1, strokeColor: '#00291F', strokeWeight: 2, clickable: false, zIndex: 3 });
    new Circle({ map, center: path[path.length - 1], radius: 11, fillColor: '#C8A96B', fillOpacity: 1, strokeColor: '#06100c', strokeWeight: 1.5, clickable: false, zIndex: 3 });
    const dot = new Circle({ map, center: path[0], radius: 11, fillColor: '#00291F', fillOpacity: 1, strokeColor: '#F0E9D8', strokeWeight: 2.5, clickable: false, zIndex: 4 });
    gmini = { map, done, dot };
  }
  const MINI_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#15271f' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#b9b2a0' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0d1a15' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c4038' }] },
    { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b2c3c' }] },
    { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  ];
  // the no-Google demo draws OUR line itself (allowed there: no Street View on screen)
  let svgMini = null;
  function ensureMiniSvg() {
    if (svgMini) return;
    const Wd = 248, H = 170, PAD = 16, svg = $('miniSvg');
    $('miniMap').hidden = true; svg.removeAttribute('hidden'); // (an <svg> has no .hidden property)
    svg.setAttribute('viewBox', `0 0 ${Wd} ${H}`);
    const lat0 = LINE[0][0], kx = Math.cos(lat0 * rad);
    const xy0 = LINE.map((p) => [p[1] * kx, -p[0]]);
    const xs = xy0.map((p) => p[0]), ys = xy0.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const s = Math.min((Wd - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
    const ox = (Wd - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s) / 2;
    const P = (p) => [ox + (p[1] * kx - minX) * s, oy + (-p[0] - minY) * s];
    const d = (pts) => pts.map((p, k) => (k ? 'L' : 'M') + P(p).map((v) => v.toFixed(1)).join(' ')).join(' ');
    const a = P(LINE[0]), z = P(LINE[LINE.length - 1]);
    svg.innerHTML = `<path class="road" d="${d(LINE)}"/><path class="route" d="${d(LINE)}"/><path class="done" id="svgDone" d=""/>`
      + `<circle class="start" cx="${a[0]}" cy="${a[1]}" r="5"/><circle class="end" cx="${z[0]}" cy="${z[1]}" r="6"/>`
      + `<text x="${a[0] + 9}" y="${a[1] + 4}">161</text><text x="${z[0] + 9}" y="${z[1] + 4}">ZEA</text>`
      + `<circle class="dot" id="svgDot" cx="${a[0]}" cy="${a[1]}" r="6"/>`;
    svgMini = { P, d };
  }
  function miniTick(t) {
    if (!S.paused) { const k = clamp((t - mini.t0) / mini.ms, 0, 1); mini.along = mini.from + (mini.to - mini.from) * k; }
    if (t - mini.last < 66) return; mini.last = t;
    if ((!gmini || !gmini.dot) && !svgMini) return;
    const b = toLine(mini.along), here = pointAt(b);
    const pts = LINE.filter((_, k) => CUM[k] < b).concat([here]);
    if (gmini && gmini.dot) { gmini.dot.setCenter({ lat: here[0], lng: here[1] }); gmini.done.setPath(pts.map((p) => ({ lat: p[0], lng: p[1] }))); }
    if (svgMini) { const q = svgMini.P(here); const dot = $('svgDot'); dot.setAttribute('cx', q[0].toFixed(1)); dot.setAttribute('cy', q[1].toFixed(1)); $('svgDone').setAttribute('d', svgMini.d(pts)); }
  }

  // ---------- demo mode visuals ----------
  let dryLast = 0;
  function dryTick(t) {
    $('dryNeedle').style.transform = `rotate(${cam.h.toFixed(1)}deg)`;
    if (t - dryLast < 100) return; dryLast = t;
    $('dryStep').textContent = S.i >= 0 ? `STEP ${S.i + 1}/${n} · ${S.along} m · ${Math.round(cam.h)}° · z${cam.z.toFixed(2)}` : `START · ${Math.round(cam.h)}°`;
  }
  function dryPulse() { const c = $('dryCompass'); c.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' }); }

  // ---------- the frame loop ----------
  let lastT = performance.now(), lastSync = 0;
  function frame(t) {
    const gap = t - lastT;
    if (touring() && !document.hidden) { const J = S.stats.jank; if (gap > 100) J.gaps100++; if (gap > 250) J.gaps250++; if (gap > J.maxGap) J.maxGap = Math.round(gap); }
    const dt = clamp(gap / 1000, 0, 0.05); lastT = t;
    // the tour clock (review R7); once a step has waited for its picture longer than the plan expects (holdExp, the
    // typical wait of this session) the countdown stands still, so a slow Google answer never makes it jump back up
    if (touring() && !S.paused) { const d = Math.min(gap, 1000); S.clock += d; if (holdOn && t - holdT0 > holdExp) S.eta += d; etaTick(d); showLeft(); }
    postState();
    const frozen = !!(fadePush && fadePush.freeze); // the opening dissolve: the building view keeps still while it fades
    if (cam.drive && !S.paused) {
      camStep(dt);
      if (S.mode === 'google' && top.pano && !frozen && (!(Math.abs(sdelta(cam.ah, cam.h)) <= 0.02) || !(Math.abs(cam.ap - cam.p) <= 0.02))) {
        top.pano.setPov({ heading: cam.h, pitch: cam.p }); cam.ah = cam.h; cam.ap = cam.p;
      }
      if (S.mode === 'google' && top.pano && !fadePush && !(Math.abs(cam.az - cam.z) <= 0.004)) { try { top.pano.setZoom(cam.z); } catch (e) { /* */ } cam.az = cam.z; }
      if (S.mode === 'google' && under.pano && (fadePush || t - lastSync > 100)) { lastSync = t; under.pano.setPov({ heading: cam.h, pitch: cam.p }); }
    }
    if (fadePush) { const k = clamp((t - fadePush.t0) / fadePush.ms, 0, 1); try { fadePush.out.pano.setZoom(fadePush.z0 + fadePush.push * k * k); } catch (e) { /* */ } }
    miniTick(t);
    if (S.mode === 'dry') dryTick(t);
    requestAnimationFrame(frame);
  }

  // ---------- errors / setup state ----------
  const STEPS_ENABLE = {
    he: [
      'היכנסו ל-<bdi>console.cloud.google.com</bdi> עם החשבון שבו נוצר מפתח התלת-ממד, ובחרו למעלה את הפרויקט <b>maoz-3d</b>.',
      'תפריט ☰ ← <b>APIs &amp; Services</b> ← <b>Library</b> ← חפשו <bdi>Maps JavaScript API</bdi> ← <b>Enable</b>. זה השלב שחסר.',
      '☰ ← <b>Billing</b>: ודאו שהפרויקט מקושר לחשבון החיוב הקיים (הוא כבר מקושר בשביל התלת-ממד – רק לוודא).',
      'לפני הפצה לעובדים: מפתח נפרד לסיור – <b>Credentials</b> ← <b>Create credentials</b> ← <b>API key</b>, הגבלה ל-<b>Websites</b> ולממשק <bdi>Maps JavaScript API</bdi> בלבד. את המפתח שומרים בקובץ <bdi>google-maps-key.txt</bdi> שבתיקייה <bdi>labs/marina-tour/.secrets</bdi> – לא בצ׳אט.',
      'מומלץ: תקרה יומית ל-<b>Map loads per day</b> (למשל 500) והתראת תקציב של $10 לחודש.',
      'חזרו לכאן ולחצו <b>נסה שוב</b>.',
    ],
    en: [
      'Open <bdi>console.cloud.google.com</bdi> with the account that made the 3D key and pick project <b>maoz-3d</b> at the top.',
      '☰ → <b>APIs &amp; Services</b> → <b>Library</b> → search <bdi>Maps JavaScript API</bdi> → <b>Enable</b>. This is the missing step.',
      '☰ → <b>Billing</b>: check the project is linked to the existing billing account (it already is for the 3D lab).',
      'Before staff use: a separate key for the tour – <b>Credentials</b> → <b>Create credentials</b> → <b>API key</b>, restricted to <b>Websites</b> and to <bdi>Maps JavaScript API</bdi> only. Save it in <bdi>labs/marina-tour/.secrets/google-maps-key.txt</bdi> – never in chat.',
      'Recommended: a daily cap on <b>Map loads per day</b> (for example 500) and a $10 monthly budget alert.',
      'Come back here and press <b>Try again</b>.',
    ],
  };
  const ERR = {
    ApiNotActivatedMapError: {
      he: { t: 'Street View עוד לא מופעל במפתח של Google', p: 'המפתח נטען, אבל בפרויקט maoz-3d לא מופעל ה-Maps JavaScript API – ובלעדיו Google לא מציג תמונות רחוב. זו פעולה חד-פעמית של כ-2 דקות:', s: STEPS_ENABLE.he },
      en: { t: 'Street View is not enabled for this Google key yet', p: 'The key loads, but the Maps JavaScript API is not enabled in project maoz-3d, and without it Google shows no street imagery. A one-time step of about 2 minutes:', s: STEPS_ENABLE.en },
    },
    ApiTargetBlockedMapError: {
      he: { t: 'המפתח לא מורשה ל-Maps JavaScript API', p: 'ה-API כבר מופעל בפרויקט, אבל במפתח עצמו יש הגבלת ממשקים (API restrictions) שלא כוללת את Maps JavaScript API – מפתח התלת-ממד מוגבל לממשקים של התלת-ממד. אחת משתי הדרכים:',
        s: ['<b>מומלץ – מפתח נפרד לסיור.</b> ☰ ← <b>APIs &amp; Services</b> ← <b>Credentials</b> ← <b>Create credentials</b> ← <b>API key</b>. שם המפתח: <bdi>marina-tour</bdi>.',
          'באותו מפתח: <b>Application restrictions</b> ← <b>Websites</b> ← הוסיפו <bdi>http://127.0.0.1:9621/*</bdi> ובהמשך גם <bdi>https://maoz-svg.github.io/*</bdi>.',
          'ובאותו מפתח: <b>API restrictions</b> ← רק <bdi>Maps JavaScript API</bdi> ← <b>Save</b>.',
          'שומרים את המפתח בקובץ <bdi>labs/marina-tour/.secrets/google-maps-key.txt</bdi> – לא בצ׳אט.',
          '<b>או במקום 1-4, מהיר:</b> ☰ ← <b>Credentials</b> ← מפתח התלת-ממד ← <b>API restrictions</b> ← סמנו גם <bdi>Maps JavaScript API</bdi> ← <b>Save</b>.',
          'Google מעדכן הגבלות תוך כ-5 דקות. אחר כך חזרו לכאן ולחצו <b>נסה שוב</b>.'] },
      en: { t: 'This key is not allowed to use the Maps JavaScript API', p: 'The API is now enabled in the project, but the key itself has API restrictions that leave out the Maps JavaScript API (the 3D key is limited to the 3D APIs). Either:',
        s: ['<b>Recommended – a separate tour key.</b> ☰ → <b>APIs &amp; Services</b> → <b>Credentials</b> → <b>Create credentials</b> → <b>API key</b>. Name it <bdi>marina-tour</bdi>.',
          'On that key: <b>Application restrictions</b> → <b>Websites</b> → add <bdi>http://127.0.0.1:9621/*</bdi> and later <bdi>https://maoz-svg.github.io/*</bdi>.',
          'And on that key: <b>API restrictions</b> → only <bdi>Maps JavaScript API</bdi> → <b>Save</b>.',
          'Save the key in <bdi>labs/marina-tour/.secrets/google-maps-key.txt</bdi> – never in chat.',
          '<b>Or instead of 1-4, quick:</b> ☰ → <b>Credentials</b> → the 3D key → <b>API restrictions</b> → also tick <bdi>Maps JavaScript API</bdi> → <b>Save</b>.',
          'Google applies restriction changes within about 5 minutes. Then come back and press <b>Try again</b>.'] },
    },
    BillingNotEnabledMapError: {
      he: { t: 'אין חשבון חיוב מקושר לפרויקט', p: 'Google דורש חשבון חיוב גם בתוך המכסה החינמית.', s: ['☰ ← <b>Billing</b> ← <b>Link a billing account</b> ← בחרו את החשבון הקיים.', 'חזרו לכאן ולחצו <b>נסה שוב</b>.'] },
      en: { t: 'No billing account is linked to the project', p: 'Google needs a billing account even inside the free monthly credit.', s: ['☰ → <b>Billing</b> → <b>Link a billing account</b> → pick the existing account.', 'Come back here and press <b>Try again</b>.'] },
    },
    RefererNotAllowedMapError: {
      he: { t: 'המפתח מוגבל לכתובות אחרות', p: 'למפתח יש הגבלת אתרים שלא כוללת את הכתובת הזו.', s: ['☰ ← <b>APIs &amp; Services</b> ← <b>Credentials</b> ← המפתח ← <b>Website restrictions</b>.', 'הוסיפו <bdi>http://127.0.0.1:9621/*</bdi> (בדיקות) ואת כתובת האתר שבו הסיור יתארח.', 'שמרו, חכו כמה דקות, וחזרו ללחוץ <b>נסה שוב</b>.'] },
      en: { t: 'The key is limited to other websites', p: 'The key has website restrictions that leave out this address.', s: ['☰ → <b>APIs &amp; Services</b> → <b>Credentials</b> → the key → <b>Website restrictions</b>.', 'Add <bdi>http://127.0.0.1:9621/*</bdi> (tests) and the address of the site that will host the tour.', 'Save, wait a few minutes, and press <b>Try again</b>.'] },
    },
    NoKey: {
      he: { t: 'אין מפתח Google', p: 'הדף לא קיבל מפתח. הוא מקבל אותו רק דרך השרת המקומי של המעבדה (serve.mjs), שקורא אותו מקובץ סודי.', s: ['שמרו את המפתח בקובץ <bdi>labs/marina-tour/.secrets/google-maps-key.txt</bdi> (או השאירו את מפתח התלת-ממד במקומו).', 'הריצו <bdi>node labs/marina-tour/serve.mjs</bdi> ופתחו <bdi>http://127.0.0.1:9621/</bdi>.'] },
      en: { t: 'No Google key', p: 'The page got no key. It only gets one through the lab\'s local server (serve.mjs), which reads it from a secret file.', s: ['Save the key in <bdi>labs/marina-tour/.secrets/google-maps-key.txt</bdi> (or keep the 3D key where it is).', 'Run <bdi>node labs/marina-tour/serve.mjs</bdi> and open <bdi>http://127.0.0.1:9621/</bdi>.'] },
    },
    InvalidKeyMapError: {
      he: { t: 'המפתח לא תקין', p: 'Google לא מזהה את המפתח.', s: ['בדקו שהקובץ הסודי מכיל את המפתח בלבד, בלי רווחים או שורות נוספות.', 'חזרו לכאן ולחצו <b>נסה שוב</b>.'] },
      en: { t: 'The key is not valid', p: 'Google does not recognise the key.', s: ['Check that the secret file holds only the key, with no spaces or extra lines.', 'Come back here and press <b>Try again</b>.'] },
    },
    LoadFailed: {
      he: { t: 'לא ניתן לטעון את Google Maps', p: 'הספרייה של Google לא נטענה (רשת, חסימה או מפתח).', s: ['בדקו חיבור לאינטרנט.', 'לחצו <b>נסה שוב</b>.'] },
      en: { t: 'Google Maps could not be loaded', p: 'Google\'s library did not load (network, blocking or key).', s: ['Check the internet connection.', 'Press <b>Try again</b>.'] },
    },
    NoData: {
      he: { t: 'נתוני המסלול לא נטענו', p: 'הדף צריך את tour.json שלידו, דרך השרת המקומי של המעבדה.', s: ['הריצו <bdi>node labs/marina-tour/serve.mjs</bdi> ופתחו <bdi>http://127.0.0.1:9621/</bdi>.'] },
      en: { t: 'The route data did not load', p: 'The page needs tour.json beside it, through the lab\'s local server.', s: ['Run <bdi>node labs/marina-tour/serve.mjs</bdi> and open <bdi>http://127.0.0.1:9621/</bdi>.'] },
    },
    NoPano: {
      he: { t: 'אין תמונת רחוב בנקודת הבניין', p: 'Google לא החזיר את תמונת הפתיחה.', s: ['לחצו <b>נסה שוב</b>; אם זה חוזר – צריך לבנות מחדש את tour.json.'] },
      en: { t: 'No street imagery at the building', p: 'Google did not return the opening view.', s: ['Press <b>Try again</b>; if it happens again, tour.json needs a rebuild.'] },
    },
    generic: {
      he: { t: 'Google לא אישר את המפתח', p: 'בדרך כלל זה אומר שה-Maps JavaScript API לא מופעל בפרויקט, או שהמפתח מוגבל. השלבים:', s: STEPS_ENABLE.he },
      en: { t: 'Google did not accept the key', p: 'Usually the Maps JavaScript API is not enabled in the project, or the key is restricted. The steps:', s: STEPS_ENABLE.en },
    },
  };
  function showErr(code) {
    if (S.apiError) return;
    S.apiError = code; S.state = 'api-error'; ev('api error: ' + code); postState();
    if (run) run.cancelled = true; run = null;
    cam.drive = false;
    const e = (ERR[code] || ERR[{ MissingKeyMapError: 'NoKey', ExpiredKeyMapError: 'InvalidKeyMapError', KeyNotAllowedMapError: 'InvalidKeyMapError' }[code]] || ERR.generic)[LANG];
    $('errTitle').textContent = e.t; $('errText').textContent = e.p;
    $('errSteps').innerHTML = e.s.map((x) => '<li>' + x + '</li>').join('');
    $('errCode').textContent = code;
    ['cta', 'hud', 'arrive', 'mini', 'loading', 'beat'].forEach((id) => { $(id).hidden = true; });
    $('err').hidden = false;
  }
  // Google reports key / project problems through gm_authFailure and a console error; it then paints its own
  // "Sorry! Something went wrong" page - we cover that with the setup card above
  window.gm_authFailure = () => setTimeout(() => showErr(S.lastGoogleError || 'gm_authFailure'), 80); // the console error names it
  const consoleError = console.error;
  console.error = function (...a) {
    try { const m = String(a[0]).match(/Google Maps JavaScript API error: (\w+)/); if (m) { S.lastGoogleError = m[1]; setTimeout(() => showErr(m[1]), 0); } } catch (e) { /* */ }
    return consoleError.apply(this, a);
  };
  let errCheck = 0;
  new MutationObserver(() => {
    if (S.apiError || errCheck) return;
    errCheck = setTimeout(() => { errCheck = 0; if (!S.apiError && document.querySelector('[class^="gm-err"],[class*=" gm-err"]')) setTimeout(() => showErr(S.lastGoogleError || 'gm-err'), 80); }, 400);
  }).observe(document.body, { childList: true, subtree: true });

  // ---------- boot ----------
  function loadGoogle(key) {
    // Google's official dynamic bootstrap loader (https://developers.google.com/maps/documentation/javascript/load-maps-js-api)
    /* eslint-disable */
    (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({ key, v: 'weekly', language: LANG === 'en' ? 'en' : 'iw' });
    /* eslint-enable */
  }

  function ready() {
    S.state = 'ready'; ev('ready on ' + S.startPano);
    $('loading').hidden = true;
    // the app's ONE click opens this page with ?autoplay=1: the tour starts by itself (review M3)
    if (AUTOPLAY && !S.autoplayed) { S.autoplayed = true; startTour(); } else $('cta').hidden = false;
  }

  async function bootGoogle() {
    if (!KEY) { showErr('NoKey'); return; }
    $('loading').hidden = false;
    stageEl.classList.add('veiled'); // (the ink + the loading pill until the building view has its first tiles)
    if (!(window.google && google.maps && google.maps.importLibrary)) loadGoogle(KEY); // (a host page may have loaded it)
    try { SV = await withTimeout(google.maps.importLibrary('streetView'), CFG.bootTimeout, 'streetView'); }
    catch (e) { showErr('LoadFailed'); return; }
    svc = new SV.StreetViewService();
    const pov = { heading: T.start.heading, pitch: T.start.pitch };
    cam.z = cam.tz = T.start.zoom;
    createPano(LA, T.start.pano, pov, OPT_FREE, T.start.zoom);
    // the owner's embed pano first; a free metadata check runs beside it, so a pano Google no longer serves falls
    // back at once (review M5) instead of after the 8 s load timeout
    const loadP = loadInto(LA, T.start.pano, pov, false);
    const checkP = withTimeout(svc.getPanorama({ pano: T.start.pano }), CFG.startCheck, 'start')
      // (its answer is kept like any metadata: the walk starts at chain[1] when the building view is within 6 m of chain[0])
      .then(({ data }) => { const m = metaOf(data); META_NOW.set(T.start.pano, m); if (!META.has(T.start.pano)) META.set(T.start.pano, Promise.resolve(m)); return 'ok'; }, (e) => (/ZERO_RESULTS|NOT_FOUND|UNKNOWN_ERROR/.test(String((e && (e.code || e.message)) || '')) ? 'missing' : 'unsure'));
    const first = await Promise.race([loadP.then((r) => ({ r })), checkP.then((c) => ({ c }))]);
    let r = first.r;
    if (!r) r = first.c === 'missing' ? { ok: false, why: 'start pano missing' } : await loadP;
    if (!r.ok && !S.apiError) { S.stats.fallbacks++; ev('start pano ' + r.why + ' -> fallback'); r = await loadInto(LA, T.start.fallback, pov, true); }
    if (S.apiError) return;
    if (!r.ok) { showErr('NoPano'); return; }
    S.startPano = LA.id; top = LA; under = LB; LA.drawn.add(LA.id);
    cam.h = cam.th = pov.heading; cam.p = cam.tp = pov.pitch;
    lookAhead(0, 4);
    // OK comes before the first tiles (real-imagery review): stay on the loading pill - and, in the app, on the overlay's
    // own loading view, which waits for the first state past 'boot' - until the building view can be drawn
    const tp = performance.now();
    const painted = await tilesIn(S.startPano, CFG.paintTiles, tilesSeen || typeof PerformanceObserver === 'function' ? CFG.paintWait.boot : 0);
    S.stats.bootPaintMs = Math.round(performance.now() - tp); ev('start painted ' + (painted ? 'tiles ' + (TILES.get(S.startPano) || 0) : 'timeout') + ' +' + S.stats.bootPaintMs + ' ms');
    if (S.apiError) return;
    stageEl.classList.add('unveil'); stageEl.classList.remove('veiled'); setTimeout(() => stageEl.classList.remove('unveil'), 700);
    ready();
  }

  function bootDry() {
    $('dry').hidden = false; $('stage').classList.add('single');
    LA.el.hidden = true; LB.el.hidden = true;
    S.startPano = T.start.pano; top.id = S.startPano;
    cam.h = cam.th = T.start.heading; cam.p = cam.tp = T.start.pitch; cam.z = cam.tz = T.start.zoom;
    ready();
  }

  function applyWords() {
    document.documentElement.lang = LANG; document.documentElement.dir = LANG === 'en' ? 'ltr' : 'rtl';
    document.title = W.title;
    document.querySelectorAll('[data-w]').forEach((el) => { const v = W[el.dataset.w]; if (typeof v === 'string') el.textContent = v; });
    $('mini').setAttribute('aria-label', W.miniAria);
    $('hold').title = W.holdTitle;
    $('btnSpeed').setAttribute('aria-label', W.speed);
    $('btnPause').setAttribute('aria-label', W.pause);
    $('lnkDry').href = '?google=0' + (LANG === 'en' ? '&lang=en' : '');
    document.body.classList.toggle('embed', EMBED);
  }

  // the key from the app (fix3, the integration draft): the copy shipped in the app has no key in its files. Embedded, it
  // asks the page that framed it once ({type:'maoz:marina-tour', need:'key'}) and takes {type:'maoz:marina-tour', key}
  // from that window only (same origin), into memory - never a URL, never storage. The lab's server still injects it.
  function keyFromParent(ms) {
    return new Promise((res) => {
      if (!EMBED || window.parent === window) { res(null); return; }
      const own = location.origin === 'null' ? '*' : location.origin;
      let to = 0;
      const done = (k) => { clearTimeout(to); window.removeEventListener('message', on); res(k); };
      const on = (e) => { const d = e.data; if (e.source !== window.parent || (own !== '*' && e.origin !== own) || !d || d.type !== 'maoz:marina-tour' || typeof d.key !== 'string' || !d.key) return; done(d.key); };
      to = setTimeout(() => done(null), ms);
      window.addEventListener('message', on);
      try { window.parent.postMessage({ type: 'maoz:marina-tour', need: 'key' }, own); } catch (e) { done(null); }
    });
  }

  async function boot() {
    applyWords();
    if (CFG.google && !KEY) { KEY = await keyFromParent(4000); S.keyVia = KEY ? 'parent' : null; }
    else S.keyVia = KEY ? 'page' : null;
    if (CFG.google && !KEY) { showErr('NoKey'); return; }
    try {
      T = await (await fetch('tour.json', { cache: 'no-store' })).json();
    } catch (e) { showErr('NoData'); return; }
    chain = T.chain; n = S.n = chain.length; LINE = T.line; S.beatIndex = T.beat.index;
    CUM = [0]; for (let k = 1; k < LINE.length; k++) CUM.push(CUM[k - 1] + dist(LINE[k - 1], LINE[k]));
    // (the water: T.water.metres from the building - since fix2 the reveal itself stands a little further, on the quay)
    $('tick').style[SIDE] = (Math.min(T.water.metres, chain[T.beat.index].along) / T.metres * 100) + '%';
    $('tickLabel').textContent = W.tick(T.water.metres);
    $('endA').textContent = W.endA; $('endB').textContent = W.endB(T.end.pier);
    $('ctaMeta').textContent = W.ctaMeta(T.water.metres, T.water.walkMinutes);
    $('arriveH').textContent = W.arrH(T.water.metres);
    $('arriveMeta').textContent = W.arrP(T.water.walkMinutes);
    $('arriveSmall').textContent = W.arrSmall(T.end.pier, roundM(T.metres));
    // in the app (embedded) the way back to the model is the main action on the arrival card
    $('btnModel').hidden = !EMBED;
    if (EMBED) { $('btnModel').className = 'pill gold'; $('btnHome').className = 'pill ghost'; }
    if (CFG.buffer === 1) $('stage').classList.add('single');
    requestAnimationFrame(frame);
    if (CFG.google) await bootGoogle(); else bootDry();
  }

  // ---------- input ----------
  $('btnTour').addEventListener('click', () => startTour());
  $('btnPause').addEventListener('click', () => setPaused(!S.paused, 'button'));
  $('btnSpeed').addEventListener('click', toggleSpeed);
  $('btnExit').addEventListener('click', () => goHome());
  $('btnHome').addEventListener('click', () => goHome());
  $('btnAgain').addEventListener('click', () => startTour());
  $('btnModel').addEventListener('click', closeEmbed);
  $('btnRetry').addEventListener('click', () => location.reload());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && touring()) { if (e.target.closest && e.target.closest('button,a')) return; e.preventDefault(); e.stopPropagation(); setPaused(!S.paused, 'space'); }
    else if (e.code === 'Escape') { if (touring() || S.state === 'done') goHome(); else if (EMBED) closeEmbed(); }
  }, true);
  // a mouse / touch press must not leave focus on a button (Space would then press it instead of pausing)
  document.addEventListener('pointerup', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) setTimeout(() => b.blur(), 0); });
  // tap on the picture pauses / resumes; dragging it pauses (look around freely, Space or tap to go on)
  let pdown = null;
  window.addEventListener('pointerdown', (e) => { pdown = $('stage').contains(e.target) ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null; }, true);
  window.addEventListener('pointermove', (e) => { if (pdown && !pdown.moved && Math.hypot(e.clientX - pdown.x, e.clientY - pdown.y) > 8) { pdown.moved = true; if (touring() && !S.paused) setPaused(true, 'drag'); } }, true);
  window.addEventListener('pointerup', () => { const p = pdown; pdown = null; if (p && !p.moved && performance.now() - p.t < 350 && touring()) setPaused(!S.paused, 'tap'); }, true);

  boot();
})();
