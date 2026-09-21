// מפת תכנון הרצליה והסביבה — one rendering of Herzliya, moved and zoomed, with the planning
// layers on it.
//
// His call (2026-09-15): no rotation. One big, smooth, beautiful picture from a single direction,
// which you pan and zoom over, and the features are drawn on top of it.
//
// The view can never run past the edge: the zoom cannot go below the scale that fills the frame,
// and the pan is clamped so the picture always covers it. No black surround, ever.
//
// Three rules he set on 2026-09-15 that shape this file:
//   * going to the plan area is a slow flight, not a jump — flyTo() eases the centre and the
//     zoom together over two and a half seconds, and any touch of the map cancels it.
//   * nothing is remembered. Close a layer and its open cards close with it; leave the map and
//     everything returns to a clean, closed, full view.
//   * every label of a layer that is on must be readable without zooming: labels that would
//     collide push each other apart instead of disappearing, and the pin stretches to keep
//     pointing at the ground it belongs to.

const $ = (id) => document.getElementById(id);
const DATA = './north-map3d-data.json';
const SVGNS = 'http://www.w3.org/2000/svg';

const S = {
  iw: 4096, ih: 2294,          // picture size, from the data file
  scale: 1, tScale: 1,          // px on screen per px of picture
  x: 0, y: 0, tx: 0, ty: 0,     // top-left of the picture in screen px
  min: 1, max: 6,
  layers: {}, labels: [], relaxRuns: 0,
};

const stage = $('stage');
const img = $('map');
/* A phone has a far tighter memory ceiling than an iPad for a web app, and iOS answers going over it
   by reloading the page - a pinch on this map on his iPhone reloaded the whole app while the iPad
   was fine (2026-09-22). On a phone the aerial is the half-size file the web build writes (the
   <img> is sized from the data, so nothing moves) and the zoom stops at four times the fitted view
   instead of seven. The desktop app has neither the file nor the ceiling and is untouched. */
const PHONE = (() => { try { return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 768; } catch { return false; } })();
const svg = $('vec');
const lays = $('lays');
const labelLayer = $('labels');

/* ---------------------------------------------------------------- view maths */
function fitScale() {
  const w = stage.clientWidth, h = stage.clientHeight;
  return Math.max(w / S.iw, h / S.ih);          // always covers the frame
}
function clamp() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const sw = S.iw * S.tScale, sh = S.ih * S.tScale;
  S.tx = sw <= w ? (w - sw) / 2 : Math.min(0, Math.max(w - sw, S.tx));
  S.ty = sh <= h ? (h - sh) / 2 : Math.min(0, Math.max(h - sh, S.ty));
}
function write() {
  const m = `translate(${S.x.toFixed(2)}px, ${S.y.toFixed(2)}px) scale(${S.scale.toFixed(5)})`;
  img.style.transform = m;
  svg.style.transform = m;
  lays.style.transform = m;
  const W = stage.clientWidth, H = stage.clientHeight;
  for (const L of S.labels) {
    const ax = S.x + L.p[0] * S.scale, ay = S.y + L.p[1] * S.scale;
    if (L.el.classList.contains('open')) {
      // an opened card is held inside the window and clear of the pills on the right, so a long
      // one can never run off the top of the screen (his report, 2026-09-15)
      // beside the pin, not on top of it: the card would otherwise cover the very thing it names
      // measured when it opened, not here: reading offsetWidth inside the frame loop forces the
      // whole document to lay out again in the middle of every frame, and there are forty-seven
      // labels in the same loop once the real-estate layer is on (2026-09-17)
      if (!L.ow) { L.ow = L.el.offsetWidth; L.oh = L.el.offsetHeight; }
      const w = L.ow, h = L.oh;
      const rightEdge = Math.max(12, W - 300);
      let left = ax + 30;
      if (left + w > rightEdge) left = ax - w - 30;
      left = Math.min(Math.max(12, left), Math.max(12, rightEdge - w));
      const top = Math.min(Math.max(12, ay - h / 2), Math.max(12, H - h - 56));
      L.el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    } else {
      // the push that separated this card from its neighbours was worked out at one zoom; it
      // fades as he zooms in, so the card closes on its own pin rather than drifting off the
      // ground it names (his report, 2026-09-16)
      const f = L.sc ? Math.min(1, L.sc / S.scale) : 1;
      const ox = L.ox * f, oy = L.oy * f;
      L.el.style.transform =
        `translate(-50%, -100%) translate(${(ax + ox).toFixed(1)}px, ${(ay + oy).toFixed(1)}px)`;
      // --tail drives the height of a pseudo-element, so writing it re-lays that label out; it
      // changes continuously while he zooms, so it is only written when the whole pixel changes
      const tail = Math.round(Math.max(10, 22 - oy));
      if (tail !== L.tail) { L.tail = tail; L.el.style.setProperty('--tail', tail + 'px'); }
    }
  }
  const z = $('zoom');
  if (z) z.textContent = Math.round((S.scale / S.min) * 100) + '%';
  if (S.relaxRuns > 0 && ++layoutTick % 2 === 0) { S.relaxRuns--; relax(); }
}

/* Labels that would sit on top of each other push one another apart instead of vanishing — he
   wants every neighbourhood readable at the full view, without zooming (2026-09-15). The card
   moves; the pin stretches so it still points at the ground it names. */
let layoutTick = 0;
function relax() {
  // Only labels whose pin is actually in the window. The clamp at the end of this function used
  // to be applied to every label of every open layer, and for a pin off the left edge its lower
  // bound comes out ABOVE its upper bound - Math.max then wins and the label is parked just inside
  // the window. Zoomed in with the real-estate layer on, fourteen of the seventeen price labels are
  // off screen; they were all dragged to the edge, shoved around each other there, and then slid
  // back out as he kept zooming. That is the price labels appearing and vanishing. (2026-09-17)
  const VW = stage.clientWidth, VH = stage.clientHeight;
  const vis = S.labels.filter((L) => {
    if (L.el.style.display === 'none' || L.el.classList.contains('open')) return false;
    const ax = S.x + L.p[0] * S.scale, ay = S.y + L.p[1] * S.scale;
    return ax > -220 && ax < VW + 220 && ay > -220 && ay < VH + 220;
  });
  if (!vis.length) return;
  for (const L of vis) {
    if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
    L.cx = S.x + L.p[0] * S.scale + L.bx;
    L.cy = S.y + L.p[1] * S.scale + L.by;
  }
  vis.sort((a, b) => a.prio - b.prio);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < vis.length; i++) {
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i], b = vis[j];
        const padX = (a.w + b.w) / 2 + 10, padY = (a.h + b.h) / 2 + 10;
        const dx = b.cx - a.cx, dy = (b.cy - b.h / 2) - (a.cy - a.h / 2);
        const ox = padX - Math.abs(dx), oy = padY - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;                 // they do not touch
        // move along whichever axis needs the least travel, and move the lesser label most
        const wA = a.prio === b.prio ? 0.5 : (a.prio > b.prio ? 0.85 : 0.15);
        if (oy / padY < ox / padX) {
          const s = (dy >= 0 ? 1 : -1) * oy * 0.55;
          a.cy -= s * wA; b.cy += s * (1 - wA);
        } else {
          const s = (dx >= 0 ? 1 : -1) * ox * 0.55;
          a.cx -= s * wA; b.cx += s * (1 - wA);
        }
      }
    }
  }
  const W = stage.clientWidth, H = stage.clientHeight;
  for (const L of vis) {
    const ax = S.x + L.p[0] * S.scale, ay = S.y + L.p[1] * S.scale;
    let tx = L.cx - ax, ty = L.cy - ay;
    ty = Math.max(-170, Math.min(50, ty));            // the pin stays believable
    tx = Math.max(-200, Math.min(200, tx));
    const loX = -(ax - L.w / 2 - 12), hiX = Math.max(0, W - 300 - (ax + L.w / 2));
    if (loX <= hiX) tx = Math.max(loX, Math.min(hiX, tx));      // never an upside-down clamp
    const loY = -(ay - L.h - 12), hiY = Math.max(0, H - 74 - ay);
    if (loY <= hiY) ty = Math.max(loY, Math.min(hiY, ty));
    L.ox += (tx - L.ox) * 0.34;
    L.oy += (ty - L.oy) * 0.34;
    L.sc = S.scale;                       // the zoom this arrangement was worked out at
  }
}
/* The arrangement is worked out once, at the view he is looking at, and then held: labels that
   moved as he zoomed in and out were the complaint (2026-09-15). Anything that changes which
   labels are on screen - a layer, a reset, a resize - asks for it to be worked out again. */
function relaxKick(n = 26) { S.relaxRuns = Math.max(S.relaxRuns || 0, n); }

/* Coarse-while-moving was tried here on 2026-09-17 and taken out again, and the reason is worth
   keeping: switching image-rendering on and off INVALIDATES every layer, so the map re-rasters
   twice per gesture on top of the work the gesture already causes. Cheaper resampling really is
   about half the cost (1,300 -> 637 ms/s while it is on), but you cannot turn it on and off without
   paying more than it saves. The real answer for this map is tiles, not a paint-property switch. */
function moving() { /* kept as a hook for the tiled version */ }
function apply(t = 1) {
  S.scale += (S.tScale - S.scale) * t;
  S.x += (S.tx - S.x) * t;
  S.y += (S.ty - S.y) * t;
  write();
}
function zoomAt(cx, cy, factor) {
  const before = { x: (cx - S.tx) / S.tScale, y: (cy - S.ty) / S.tScale };
  S.tScale = Math.min(S.max, Math.max(S.min, S.tScale * factor));
  S.tx = cx - before.x * S.tScale;
  S.ty = cy - before.y * S.tScale;
  clamp();
}

/* ------------------------------------------------- the slow approach (his ask, 2026-09-15)
   The centre of the screen travels in the picture's own coordinates while the zoom grows
   geometrically — that is what makes a map flight read as coming closer rather than jumping. */
let fly = null;
function flyTo(scale, cx, cy, ms = 2600) {
  moving();
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const s1 = Math.min(S.max, Math.max(S.min, scale));
  fly = {
    t0: performance.now(), ms,
    s0: S.scale, c0: [(w / 2 - S.x) / S.scale, (h / 2 - S.y) / S.scale],
    s1, c1: [cx, cy],
  };
}
function stopFly() { fly = null; }
function stepFly() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const k = Math.min(1, (performance.now() - fly.t0) / fly.ms);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // ease in and out
  S.tScale = fly.s0 * Math.pow(fly.s1 / fly.s0, e);
  const cx = fly.c0[0] + (fly.c1[0] - fly.c0[0]) * e;
  const cy = fly.c0[1] + (fly.c1[1] - fly.c0[1]) * e;
  S.tx = w / 2 - cx * S.tScale;
  S.ty = h / 2 - cy * S.tScale;
  clamp();
  S.scale = S.tScale; S.x = S.tx; S.y = S.ty;
  write();
  if (k >= 1) fly = null;
}

/* ---------------------------------------------------------------- input
   One set of handlers, pointer events only. The old code listened for touch events as well as
   pointer events, so putting two fingers down started a PAN on the first finger and a PINCH on
   the pair at the same time, and the map slid away sideways while it zoomed (his report,
   2026-09-16). Now the pointers are counted: one pans, two pinch about their own midpoint and
   follow it, and a gesture writes straight to the view instead of easing toward it, so the map
   sits under the finger. */
const pointers = new Map();
let gesture = null;
function snap() { S.scale = S.tScale; S.x = S.tx; S.y = S.ty; write(); }
function regrip() {
  const a = [...pointers.values()];
  const r = stage.getBoundingClientRect();
  if (a.length === 1) gesture = { mode: 'pan', x: a[0].x, y: a[0].y, tx: S.tx, ty: S.ty };
  else if (a.length >= 2) gesture = {
    mode: 'pinch',
    d: Math.max(1, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)),
    mx: (a[0].x + a[1].x) / 2 - r.left, my: (a[0].y + a[1].y) / 2 - r.top,
  };
  else gesture = null;
  stage.classList.toggle('grabbing', !!gesture);
}
stage.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
  e.preventDefault();
  stopFly();
  try { stage.setPointerCapture(e.pointerId); } catch { /* already gone */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  regrip();
});
stage.addEventListener('pointermove', (e) => {
  if (pointers.size) moving();
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  const a = [...pointers.values()];
  const r = stage.getBoundingClientRect();
  if (gesture.mode === 'pan' && a.length === 1) {
    S.tx = gesture.tx + (a[0].x - gesture.x);
    S.ty = gesture.ty + (a[0].y - gesture.y);
    clamp(); snap();
  } else if (gesture.mode === 'pinch' && a.length >= 2) {
    const dd = Math.max(1, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y));
    const mx = (a[0].x + a[1].x) / 2 - r.left, my = (a[0].y + a[1].y) / 2 - r.top;
    S.tx += mx - gesture.mx; S.ty += my - gesture.my;        // the map follows the two fingers
    zoomAt(mx, my, dd / gesture.d);                          // and scales about the point between them
    gesture.d = dd; gesture.mx = mx; gesture.my = my;
    snap();
  }
});
const lift = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  try { stage.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
  regrip();
};
stage.addEventListener('click', () => closeCards());
stage.addEventListener('pointerup', lift);
stage.addEventListener('pointercancel', lift);
stage.addEventListener('lostpointercapture', lift);
stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  moving();
  stopFly();
  const r = stage.getBoundingClientRect();
  // a notch of the wheel is about 40% now, not 15% - it was too slow to get anywhere (his report)
  const step = Math.min(0.62, Math.abs(e.deltaY) * (e.deltaMode === 1 ? 0.055 : 0.0034));
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-Math.sign(e.deltaY) * step));
}, { passive: false });

/* ---------------------------------------------------------------- drawing */
const el = (n, a = {}) => { const e = document.createElementNS(SVGNS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
const d = (pts, close) => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + (close ? ' Z' : '');
const nis = (v) => '₪' + Number(v).toLocaleString('en-US');

function glowPath(g, pts, { close = false, w = 3, colour = '#f0d089', core = '#fff6e2', glow = 2.8, dash = 0 } = {}) {
  if (!pts || pts.length < 2) return null;
  // no feGaussianBlur here: a wide soft stroke reads the same and does not have to be re-filtered
  // at every zoom level (that was the map's one long frame, measured 2026-09-15)
  const halo = el('path', { d: d(pts, close), fill: 'none', stroke: colour, 'stroke-width': w * glow * 1.25,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.22 });
  const line = el('path', { d: d(pts, close), fill: 'none', stroke: core, 'stroke-width': w,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.95 });
  if (dash) line.setAttribute('stroke-dasharray', dash);
  halo.classList.add('vw'); line.classList.add('vw');
  g.appendChild(halo); g.appendChild(line);
  return line;
}
function fillPoly(g, pts, { colour = '#f0d089', opacity = 0.14 } = {}) {
  const p = el('path', { d: d(pts, true), fill: colour, opacity, stroke: 'none' });
  g.appendChild(p);
  return p;
}
function label(p, html, cls = '') {
  const e = document.createElement('div');
  e.className = 'lab ' + cls;
  e.innerHTML = html;
  labelLayer.appendChild(e);
  const rec = { el: e, p, layer: null, prio: 5, w: 0, h: 0, ow: 0, oh: 0, tail: 0, bx: 0, by: 0, ox: 0, oy: 0, cx: 0, cy: 0, sc: 0 };
  S.labels.push(rec);
  return rec;
}
function closeCards() {
  for (const r of S.labels) if (r.el.classList.contains('open')) { r.el.classList.remove('open'); r.w = 0; r.ow = 0; }
  document.body.classList.remove('card-open');
}
/** a label that opens into a card in place; a second click closes it */
function openable(rec) {
  rec.el.classList.add('op');
  rec.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  rec.el.addEventListener('click', (e) => {
    e.stopPropagation();
    const was = rec.el.classList.contains('open');
    closeCards();
    rec.el.classList.toggle('open', !was);
    rec.w = 0; rec.ow = 0;
    relaxKick();
    document.body.classList.toggle('card-open', !was);
  });
  return rec;
}

/* ---------------------------------------------------------------- build */
const LAYERS = [
  ['site',    'גבול המתחם',          'קו המתאר של הרובע'],
  ['quarter', 'שכונת הרובע הצפוני', 'ההדמיה על שטח התוכנית'],
  ['plans',   'תוכניות הרובע הצפוני', 'תמ״ל 3006 · תמ״ל 3006/א'],
  ['future',  'תוכניות פיתוח עתידיות', 'המתחמים המתוכננים באזור'],
  ['metro',   'תוכנית המטרו',        'תוואי ותחנות'],
  ['prices',  'נתוני נדל״ן',          'מחיר ממוצע למ״ר'],
  ['zoning',  'ייעוד הקרקע',          'צביעת הגושים והחלקות'],
  ['parcels', 'גושים וחלקות',         'גוש 6663 · חלקה 18'],
  ['roads',   'עורקי תנועה ראשיים',   'מספרי הכבישים'],
];
const MAPS = [
  ['xplan',  'XPLAN · מנהל התכנון', 'ייעודי קרקע ותוכניות'],
  ['rami',   'מאגר תוכניות רמ״י',   'TabaSearch'],
  ['google', 'Google Maps',          'תצלום לוויין'],
];

let SITE = null;

async function boot() {
  const prog = $('prog');
  const step = (n) => { if (prog) prog.style.width = n + '%'; };
  step(10);
  let data;
  try { data = await (await fetch(DATA, { cache: 'no-store' })).json(); }
  catch { data = {}; }
  S.iw = (data.imageSize && data.imageSize[0]) || 4096;
  S.ih = (data.imageSize && data.imageSize[1]) || 2294;

  await new Promise((res) => {
    img.onload = res; img.onerror = res;
    img.src = (PHONE && window.MAOZ_PHONE_AERIAL) || data.image || 'north/map3d/city-oblique.jpg';
  });
  step(46);
  // decode the picture at its own resolution now, while the bar is still up: otherwise the first
  // zoom that crosses into the 1:1 tier pays for 37 megapixels in a single frame (measured 550ms)
  try { await img.decode(); } catch { /* an older engine, or a broken file */ }
  step(58);
  img.width = S.iw; img.height = S.ih;
  svg.setAttribute('viewBox', `0 0 ${S.iw} ${S.ih}`);
  svg.setAttribute('width', S.iw); svg.setAttribute('height', S.ih);

  for (const [id] of LAYERS) {
    const g = el('g', { class: 'layer-' + id });
    g.style.display = 'none';
    svg.appendChild(g);
    S.layers[id] = { g, on: false, labs: labDef(id) };
  }

  const F = data.features || {};
  SITE = F.site || null;
  // The map opens clean (his ask, 2026-09-15). The compound's outline is a switch like anything
  // else, so nothing is drawn over the city until he asks for it.
  if (F.site) {
    const g = S.layers.site.g;
    fillPoly(g, F.site, { colour: '#f0d089', opacity: 0.07 });
    glowPath(g, F.site, { close: true, w: 3.4, glow: 3.2 });
  }
  buildZoning(F);
  buildQuarter(F);
  buildPlans(F);
  buildFuture(F);
  buildMetro(F);
  buildPrices(F);
  buildParcels(F);
  buildRoads(F);

  const list = $('railList');
  for (const [id, name, sub] of LAYERS) {
    const b = document.createElement('button');
    b.className = 'fbtn'; b.dataset.layer = id;
    b.innerHTML = `<span class="dot"></span><span class="lbl">${name}<span class="sub">${sub}</span></span>`;
    b.addEventListener('click', () => toggle(id));
    if (S.labels.some((r) => r.layer === id)) {
      const t = document.createElement('span');
      t.className = 'labtog'; t.dataset.layer = id;
      t.setAttribute('role', 'button'); t.tabIndex = 0;
      const dm = labDef(id);
      t.innerHTML = LAB_ICON[dm]; t.title = LAB_TITLE[dm];
      t.classList.toggle('dot', dm === 'dot');
      const hit = (e) => { e.stopPropagation(); e.preventDefault(); cycleLabels(id); };
      t.addEventListener('click', hit);
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') hit(e); });
      b.appendChild(t);
    }
    list.appendChild(b);
  }
  const mapsList = $('mapsList');
  for (const [id, name, sub] of MAPS) {
    const b = document.createElement('button');
    b.className = 'fbtn';
    b.innerHTML = `<span class="lbl">${name}<span class="sub">${sub}</span></span><span class="go">↗</span>`;
    b.addEventListener('click', () => openMap(id));
    mapsList.appendChild(b);
  }
  fold('rail', 'railHead', true);
  fold('maps', 'mapsHead', false);

  for (const r of S.labels) if (r.layer) r.el.style.display = 'none';
  resize(true);
  relaxKick(40);
  step(80);
  // decode the layer pictures now rather than on the frame a switch is thrown
  await Promise.all(layerImgs.map((im) => (im.el.decode ? im.el.decode().catch(() => {}) : Promise.resolve())));
  step(100);
  setTimeout(() => $('load').classList.add('gone'), 240);
  $('reset').addEventListener('click', () => { stopFly(); flyTo(S.min, S.iw / 2, S.ih / 2, 1500); });
  $('site').addEventListener('click', () => goSite());
}

function fold(pillId, headId, open) {
  const pill = $(pillId), head = $(headId);
  pill.classList.toggle('open', !!open);
  head.setAttribute('aria-expanded', String(!!open));
  head.addEventListener('click', () => {
    const o = pill.classList.toggle('open');
    head.setAttribute('aria-expanded', String(o));
  });
}

/* The planning authority's own sheet, the two views of it side by side behind one switch.
   It opens on the clean view every time (his ask, 2026-09-16). */
const ORIG = { clean: 'north/map3d/orig-clean.jpg', zoning: 'north/map3d/orig-zoning.jpg' };
function showOrig(which) {
  const img = $('origImg');
  // the two sheets are the same frame, so swapping them keeps the place he was looking at
  const keep = img && img.naturalWidth ? { k: OZ.k, x: OZ.x, y: OZ.y } : null;
  if (img) {
    img.onload = () => { if (keep) { OZ.k = keep.k; OZ.x = keep.x; OZ.y = keep.y; ozWrite(); } else ozFit(); };
    img.src = ORIG[which] || ORIG.clean;
  }
  document.querySelectorAll('.orig-tab').forEach((b) => b.classList.toggle('on', b.dataset.orig === which));
}
function closeOrig() { const o = $('orig'); if (o) o.hidden = true; }

/* The sheet is 2,876 pixels wide and the numbers on it are small, so the window it opens in is a
   little viewer of its own: it starts fitted, the wheel zooms about the pointer and it drags. */
const OZ = { k: 1, x: 0, y: 0, fit: 1 };
function ozWrite() {
  const img = $('origImg'), body = $('origBody');
  if (!img || !body || !img.naturalWidth) return;
  const W = img.naturalWidth * OZ.k, H = img.naturalHeight * OZ.k;
  const vw = body.clientWidth, vh = body.clientHeight;
  OZ.x = W <= vw ? (vw - W) / 2 : Math.min(0, Math.max(vw - W, OZ.x));
  OZ.y = H <= vh ? (vh - H) / 2 : Math.min(0, Math.max(vh - H, OZ.y));
  img.style.transform = `translate(${OZ.x.toFixed(1)}px, ${OZ.y.toFixed(1)}px) scale(${OZ.k.toFixed(4)})`;
  const l = $('ozLvl');
  if (l) l.textContent = Math.round((OZ.k / OZ.fit) * 100) + '%';
}
function ozFit() {
  const img = $('origImg'), body = $('origBody');
  if (!img || !body || !img.naturalWidth) return;
  OZ.fit = Math.min(body.clientWidth / img.naturalWidth, body.clientHeight / img.naturalHeight);
  OZ.k = OZ.fit; OZ.x = 0; OZ.y = 0; ozWrite();
}
function ozZoom(px, py, f) {
  const img = $('origImg');
  if (!img || !img.naturalWidth) return;
  const k2 = Math.max(OZ.fit * 0.8, Math.min(6, OZ.k * f));
  OZ.x = px - (px - OZ.x) * (k2 / OZ.k);
  OZ.y = py - (py - OZ.y) * (k2 / OZ.k);
  OZ.k = k2; ozWrite();
}

$('ozIn')?.addEventListener('click', () => { const b = $('origBody'); ozZoom(b.clientWidth / 2, b.clientHeight / 2, 1.25); });
$('ozOut')?.addEventListener('click', () => { const b = $('origBody'); ozZoom(b.clientWidth / 2, b.clientHeight / 2, 1 / 1.25); });
$('ozLvl')?.addEventListener('click', ozFit);
$('origBody')?.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = $('origBody').getBoundingClientRect();
  ozZoom(e.clientX - r.left, e.clientY - r.top, Math.exp(-Math.sign(e.deltaY) * Math.min(0.5, Math.abs(e.deltaY) * 0.0032)));
}, { passive: false });
(() => {
  const body = $('origBody');
  if (!body) return;
  let g = null;
  body.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.orig-zoom')) return;
    e.preventDefault();
    try { body.setPointerCapture(e.pointerId); } catch { /* gone */ }
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: OZ.x, oy: OZ.y };
    body.classList.add('drag');
  });
  body.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    OZ.x = g.ox + (e.clientX - g.x); OZ.y = g.oy + (e.clientY - g.y); ozWrite();
  });
  const up = () => { g = null; body.classList.remove('drag'); };
  body.addEventListener('pointerup', up);
  body.addEventListener('pointercancel', up);
  body.addEventListener('lostpointercapture', up);
})();
addEventListener('resize', () => { if (!$('orig')?.hidden) ozFit(); });
$('origBtn')?.addEventListener('click', () => { OZ.k = 0; showOrig('clean'); $('orig').hidden = false; setTimeout(ozFit, 40); });
$('origX')?.addEventListener('click', closeOrig);
$('orig')?.addEventListener('click', (e) => { if (e.target === $('orig')) closeOrig(); });
document.querySelectorAll('.orig-tab').forEach((b) => b.addEventListener('click', () => showOrig(b.dataset.orig)));
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOrig(); });

function openMap(mode) {
  try { parent.postMessage({ maoz: 'openMap', mode }, '*'); } catch { /* standalone */ }
}

/* Leaving the map puts it back the way it was found: every layer off, every card closed, the
   menus at rest and the full view (his ask, 2026-09-15). The shell asks for this when the map
   is closed, so it holds whether or not the frame itself survives. */
function resetAll() {
  closeCards();
  closeOrig();
  for (const id in S.layers) if (S.layers[id].on) toggle(id);
  $('rail').classList.add('open'); $('railHead').setAttribute('aria-expanded', 'true');
  $('maps').classList.remove('open'); $('mapsHead').setAttribute('aria-expanded', 'false');
  for (const r of S.labels) { r.ox = 0; r.oy = 0; r.by = r.byFull || 0; }
  for (const id in S.layers) { S.layers[id].labs = labDef(id); syncLabels(id); }
  stopFly();
  resize(true);
  relaxKick(40);
}
addEventListener('message', (e) => {
  const m = e.data;
  if (m && m.maoz === 'imapReset') resetAll();
});

function bbox(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
function bboxCentre(poly) { const b = bbox(poly); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }
function goSite() {
  if (!SITE) return;
  const b = bbox(SITE);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const s = Math.min(S.max, Math.max(S.min, Math.min(stage.clientWidth / (w * 1.5), stage.clientHeight / (h * 1.5))));
  flyTo(s, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 2600);
}
/* Full label, a single glowing pin, or nothing - one control cycles the three (his ask). */
const LAB_MODES = ['full', 'dot', 'off'];
/* The plans open as pins: eight labels at once buried the compounds they name (his ask). */
const LAB_DEF = { future: 'dot' };
function labDef(id) { return LAB_DEF[id] || 'full'; }
const LAB_TITLE = { full: 'צמצום תוויות', dot: 'הסתר תוויות', off: 'הצגת תוויות' };
const LAB_ICON = {
  full: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.6" y="4.2" width="12.8" height="7.6" rx="2"/><path d="M4.4 8h7.2"/></svg>',
  dot: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.6" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="5.6"/></svg>',
  off: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.6" y="4.2" width="12.8" height="7.6" rx="2"/><path d="M2.4 13.4 13.6 2.6"/></svg>',
};
function syncLabels(id) {
  const L = S.layers[id];
  if (!L) return;
  const mode = L.labs || labDef(id);
  for (const r of S.labels) {
    if (r.layer !== id) continue;
    r.el.style.display = (L.on && mode !== 'off') ? '' : 'none';
    r.el.classList.toggle('dotted', mode === 'dot');
    if (mode !== 'dot' && r.el.classList.contains('open')) { /* keep it open */ }
    r.by = mode === 'dot' ? 0 : (r.byFull || 0);
    r.w = 0;
  }
  const t = document.querySelector(`.labtog[data-layer="${id}"]`);
  if (t) {
    t.innerHTML = LAB_ICON[mode];
    t.title = LAB_TITLE[mode];
    t.setAttribute('aria-label', LAB_TITLE[mode]);
    t.classList.toggle('dot', mode === 'dot');
    t.classList.toggle('off', mode === 'off');
  }
  relaxKick();
}
function cycleLabels(id) {
  const L = S.layers[id];
  if (!L) return;
  L.labs = LAB_MODES[(LAB_MODES.indexOf(L.labs || labDef(id)) + 1) % LAB_MODES.length];
  if (L.labs === 'off') closeCards();
  syncLabels(id);
}

function toggle(id) {
  const L = S.layers[id];
  if (!L) return;
  L.on = !L.on;
  L.g.style.display = L.on ? '' : 'none';
  for (const im of layerImgs) if (im.id === id) im.el.classList.toggle('on', L.on);
  for (const r of S.labels) if (r.layer === id) {
    r.w = 0;
    if (!L.on) { r.el.classList.remove('open'); r.ox = 0; r.oy = 0; }   // a closed layer forgets
  }
  syncLabels(id);
  if (!document.querySelector('.lab.open')) document.body.classList.remove('card-open');
  document.querySelector(`.fbtn[data-layer="${id}"]`)?.classList.toggle('on', L.on);
  if (id === 'zoning') { $('key').classList.toggle('show', L.on); $('origBtn').classList.toggle('show', L.on); }
  const n = Object.values(S.layers).filter((x) => x.on).length;
  const badge = $('railN');
  if (badge) { badge.textContent = n; badge.classList.toggle('show', n > 0); }
}

/* ---------------------------------------------------------------- the layers */
/** his own drawing, lifted off the screenshot and warped onto the ground it belongs to */
const layerImgs = [];
function drawImageLayer(id, spec) {
  if (!spec || !spec.image || !spec.box) return;
  const [x, y, w, h] = spec.box;
  const e = document.createElement('img');
  e.src = spec.image;
  e.alt = '';
  e.draggable = false;
  e.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;opacity:${spec.opacity ?? 1}`;
  lays.appendChild(e);
  layerImgs.push({ id, el: e });
}
function buildZoning(F) {
  const g = S.layers.zoning.g, Z = F.zoning || {};
  drawImageLayer('zoning', Z.img);
  for (const a of Z.areas || []) {
    fillPoly(g, a.poly, { colour: a.c, opacity: a.o ?? 0.5 });
    glowPath(g, a.poly, { close: true, w: 1.2, colour: a.c, core: a.c, glow: 1.5 });
  }
  const ul = $('keyList');
  if (ul) ul.innerHTML = (Z.key || []).map((k) => `<li><i style="background:${k.c}"></i>${k.t}</li>`).join('');
}
/** the approved rendering, laid onto the ground it belongs to */
function buildQuarter(F) {
  const g = S.layers.quarter.g, q = F.quarter || {};
  if (q.img) { drawImageLayer('quarter', q.img); return; }
  if (q.image && q.box) {
    const defs = svg.querySelector('defs');
    const im = el('image', { href: q.image, x: q.box[0], y: q.box[1], width: q.box[2], height: q.box[3],
      preserveAspectRatio: 'none', opacity: q.opacity ?? 1 });
    if (q.clip && defs) {
      const cp = el('clipPath', { id: 'qclip', clipPathUnits: 'userSpaceOnUse' });
      cp.appendChild(el('path', { d: d(q.clip, true) }));
      defs.appendChild(cp);
      im.setAttribute('clip-path', 'url(#qclip)');
    }
    g.appendChild(im);
    glowPath(g, q.clip || F.site, { close: true, w: 2.4, glow: 2.6 });
    return;
  }
  for (const p of q.parks || []) fillPoly(g, p, { colour: '#79c169', opacity: 0.42 });
  for (const r of q.roads || []) glowPath(g, r, { w: 2, colour: '#e8e2d2', core: '#f6f2e6', glow: 2 });
  for (const b of q.blocks || []) {
    const h = b.h || 9;
    fillPoly(g, b.poly, { colour: h >= 30 ? '#fff4dc' : h >= 20 ? '#f2f7f4' : '#dfeae2', opacity: 0.30 + Math.min(0.42, h / 70) });
    glowPath(g, b.poly, { close: true, w: 1, colour: h >= 30 ? '#f0d089' : '#cfd8cf', core: '#ffffff', glow: 1.6 });
  }
}
/** תמ״ל 3006 and תמ״ל 3006/א — each outlined, named, and openable onto its own figures */
function buildPlans(F) {
  const g = S.layers.plans.g;
  for (const p of F.plans || []) {
    if (p.poly) {
      fillPoly(g, p.poly, { colour: p.c || '#ff8a5c', opacity: 0.16 });
      glowPath(g, p.poly, { close: true, w: 3, colour: p.c || '#ff8a5c', core: '#ffd9c6', glow: 3 });
    }
    const rec = label(p.lp || (p.poly && bboxCentre(p.poly)),
      `<div class="card">` +
        `<span class="nm">${p.t}</span>` +
        `<span class="un">${p.plan}</span>` +
        planPanel(p) +
      `</div>`, 'pin plan');
    rec.layer = 'plans'; rec.prio = 1;
    openable(rec);
  }
}
function planPanel(p) {
  return `<div class="panel wide">
    <div class="kick">${p.plan}${p.pid ? ' · ' + p.pid : ''}</div>
    <div class="big"><b>${Number(p.units).toLocaleString('en-US')}</b><i>יחידות דיור</i></div>
    <div class="rule"></div>
    <div class="grid2">${(p.facts || []).map((f) => `<div class="kv"><span>${f.k}</span><b>${f.v}</b></div>`).join('')}</div>
  </div>`;
}
/* The plans taking shape around the compound (his ask, 2026-09-16). Each one is outlined where
   he marked it on his own screenshot of this map, and its pin opens the figures and the planning
   stage. The North Quarter is in here too, so the switch shows the whole neighbourhood at once. */
function buildFuture(F) {
  const g = S.layers.future.g;
  for (const p of F.future || []) {
    // the quarter as it would be built, keyed to the compound he outlined
    if (p.render) drawImageLayer('future', p.render);
    // no boundary line: he wants the rendering and the label, nothing drawn over them
    const rec = label(p.c2 || (p.poly && bboxCentre(p.poly)),
      `<div class="card">` +
        `<span class="nm">${p.t}</span>` +
        `<span class="un">${p.plan || ''}</span>` +
        futurePanel(p) +
      `</div>`, 'pin plan fut' + (p.ours ? ' ours' : ''));
    rec.layer = 'future'; rec.prio = p.ours ? 1 : 3;
    rec.byFull = -104; rec.by = -104;    // it rides above the compound, not over it
    openable(rec);
  }
}
function futurePanel(p) {
  const facts = (p.facts || []).map((f) => `<div class="kv"><span>${f.k}</span><b>${f.v}</b></div>`).join('');
  return `<div class="panel wide">
    <div class="kick">${p.plan || ''}${p.status ? ' · ' + p.status : ''}</div>
    ${p.units ? `<div class="big"><b>${Number(p.units).toLocaleString('en-US')}</b><i>יחידות דיור</i></div><div class="rule"></div>` : ''}
    ${facts ? `<div class="grid2">${facts}</div>` : ''}
    ${p.note ? `<div class="note">${p.note}</div>` : ''}
    ${p.src ? `<div class="srcline">${p.src}</div>` : ''}
  </div>`;
}
/* The alignment is traced from his own official sheet - 177 strands, the whole network in the
   frame, not the twenty-six the first pass found - and drawn the way a metro is drawn: a dark
   casing under a bright core, round joins and caps, so it reads as one continuous line through the
   city instead of a bare blue stroke. The stations are the magenta platforms off the same sheet,
   marked with a ring and given a small name tag rather than a full card. (his ask, 2026-09-17) */
function buildMetro(F) {
  const g = S.layers.metro.g;
  drawImageLayer('metro', F.metro && F.metro.img);
  // the corridor exactly as the planning sheet draws it: one path of all its outlines, filled with
  // the even-odd rule so the holes inside stay holes, under a thin dark edge that keeps it crisp
  /* ONE PATH PER STRAND, NOT ONE PATH FOR THE WHOLE LINE.
     The corridor is 42 traced rings. Joining them into a single path made a shape whose BOUNDING
     BOX covers 47% of the map, and Skia builds a path's whole edge list for every tile that touches
     its bounds before it clips - so 1,176 of the vector layer's tiles walked all 701 points, twice,
     and only 181 of them had any ink to show for it. That is what was different about this layer:
     every other one is either a picture with its own small box, or a handful of points in a corner.
     On a zoom step those tile jobs queue up behind the frame, the compositor draws the new scale
     with the old tiles missing, and the map comes apart in pieces - with the metro on, Chromium
     reported 1,619 checkerboarded frames against 174 with the corridor hidden.
     Split into one path per strand, each carrying its own holes so the even-odd rule still cuts
     them out, the bounding boxes add up to 10.9% instead of 47% and the largest single one is 1.75%
     - smaller than anything else already on the map. The drawing is identical to the pixel: no two
     strands overlap, so parity never crossed between them anyway. (2026-09-17) */
  const shapes = (F.metro && F.metro.shapes) || [];
  if (shapes.length) {
    const inside = (pt, poly) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    const area = (poly) => {
      let a = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      return Math.abs(a) / 2;
    };
    const solids = shapes.filter((s) => !s.hole);
    const groups = solids.map((s) => [s.p]);
    for (const h of shapes.filter((s) => s.hole)) {
      let best = -1, bestArea = Infinity;
      solids.forEach((s, i) => {                       // the smallest solid that contains it
        if (!inside(h.p[0], s.p)) return;
        const a = area(s.p);
        if (a < bestArea) { bestArea = a; best = i; }
      });
      if (best >= 0) groups[best].push(h.p);
      else groups.push([h.p]);                         // a ring with no parent is just a shape
    }
    // no strokes: a stroke on a path this long is the most expensive thing on the map at a zoom
    // step - 41.7 ms in one raster task against 14.6 without (measured 2026-09-17). The darker
    // path underneath is offset by a hair instead, which reads as the same edge.
    const unders = [], fills = [];
    for (const rings of groups) {
      const dd = rings.map((r) => d(r, true)).join(' ');
      const under = el('path', { d: dd, 'fill-rule': 'evenodd', fill: '#06283a', opacity: 0.62 });
      const fill = el('path', { d: dd, 'fill-rule': 'evenodd', fill: '#3fb9ff', opacity: 0.94 });
      under.setAttribute('transform', 'translate(1.6,1.6)');
      unders.push(under); fills.push(fill);
    }
    for (const e of unders) g.appendChild(e);          // every shadow first, then every band
    for (const e of fills) g.appendChild(e);
  }
  for (const line of (F.metro && F.metro.lines) || []) {
    const pts = Array.isArray(line) ? line : line.path;
    if (pts && pts.length > 1) glowPath(g, pts, { w: 6, colour: '#3fb9ff', core: '#d6f2ff', glow: 3.2 });
  }
  for (const s of (F.metro && F.metro.stations) || []) {
    const ring = el('circle', { cx: s.p[0], cy: s.p[1], r: 13, fill: '#06283a', stroke: '#eaf7ff', 'stroke-width': 5, opacity: 0.98 });
    const dot = el('circle', { cx: s.p[0], cy: s.p[1], r: 4.5, fill: '#3fb9ff' });
    ring.classList.add('vw'); dot.classList.add('vw');
    g.appendChild(ring); g.appendChild(dot);
    const st = label(s.p, `<div class="card"><span class="nm">${s.t.replace(/^תחנת\s*/, '')}</span></div>`, 'pin station');
    st.layer = 'metro'; st.prio = 2; st.byFull = -30; st.by = -30;
  }
}
function buildPrices(F) {
  const q = F.forecast;
  if (q) {
    const rec = label(q.p,
      `<div class="card">` +
        `<span class="nm">${q.t}</span>` +
        `<span class="pr">${nis(q.price)}</span><span class="un">צפי מחיר למ״ר</span>` +
        forecastPanel(q) +
      `</div>`, 'pin price');
    rec.layer = 'prices'; rec.prio = 0;
    openable(rec);
  }
  for (const n of F.prices || []) {
    const rec = label(n.p,
      `<div class="card">` +
        `<span class="nm">${n.t}</span>` +
        (n.price ? `<span class="pr">${nis(n.price)}</span><span class="un">ממוצע למ״ר</span>` : '') +
        (n.series ? `<div class="panel">${chartHTML(n)}</div>` : '') +
        // a neighbourhood with no published series can still carry what IS known about it
        (!n.series && n.facts ? `<div class="panel wide" style="width:360px">` +
          `<div class="kick">${n.kick || n.t}</div>` +
          (n.price ? `<div class="big"><b>${nis(n.price)}</b><i>למ״ר</i></div>` : '') +
          (n.low && n.high ? `<div class="rng">טווח ${nis(n.low)} – ${nis(n.high)} למ״ר</div>` : '') +
          `<div class="rule"></div>` +
          `<div class="grid2">${n.facts.map((f) => `<div class="kv"><span>${f.k}</span><b>${f.v}</b></div>`).join('')}</div>` +
          (n.note ? `<div class="note">${n.note}</div>` : '') +
          (n.conf ? `<div class="foot2">${n.conf}</div>` : '') +
          (n.src ? `<div class="srcline">${n.src}</div>` : '') +
        `</div>` : '') +
      `</div>`, 'pin price');
    rec.layer = 'prices'; rec.prio = 4;
    if (n.series || n.facts) openable(rec);
  }
  for (const s of F.streets || []) {
    const rec = label(s.p,
      `<div class="card">` +
        `<span class="nm">${s.t}</span>` +
        `<span class="pr">${nis(s.price)}</span><span class="un">ממוצע למ״ר · רחוב</span>` +
        `<div class="panel wide" style="width:340px">` +
          `<div class="kick">רחוב ${s.t}</div>` +
          `<div class="big"><b>${nis(s.price)}</b><i>למ״ר</i></div>` +
          (s.low && s.high ? `<div class="rng">טווח ${nis(s.low)} – ${nis(s.high)} למ״ר</div>` : '') +
          `<div class="rule"></div>` +
          `<div class="rows"><div class="row"><i></i><div><span>${s.note}</span></div></div></div>` +
          (s.conf ? `<div class="foot2">${s.conf}</div>` : '') +
        `</div>` +
      `</div>`, 'pin price street');
    rec.layer = 'prices'; rec.prio = 3;
    openable(rec);
  }
}

/** why the quarter should be worth what it is worth — short, and mostly drawn (his ask) */
function forecastPanel(q) {
  const W = 400, H = 136, PAD_L = 14, PAD_R = 14, PAD_T = 28, PAD_B = 34;
  const st = q.steps || [];
  const vs = st.map((s) => s.v).concat([q.high, q.low]);
  const lo = Math.min(...vs) * 0.9, hi = Math.max(...vs) * 1.05;
  const x = (i) => PAD_L + (i * (W - PAD_L - PAD_R)) / Math.max(1, st.length - 1);
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const line = st.map((s, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s.v).toFixed(1)).join(' ');
  const area = line + ` L ${x(st.length - 1).toFixed(1)} ${H - PAD_B} L ${x(0).toFixed(1)} ${H - PAD_B} Z`;
  const band = `<rect class="bd" x="${(x(st.length - 1) - 26).toFixed(1)}" y="${y(q.high).toFixed(1)}" width="30" height="${Math.max(2, y(q.low) - y(q.high)).toFixed(1)}" rx="3"/>`;
  const pts = st.map((s, i) => `<circle class="${i === st.length - 1 ? 'pf' : 'pt'}" cx="${x(i).toFixed(1)}" cy="${y(s.v).toFixed(1)}" r="4.5"/>`).join('');
  const anch = (i) => (i === 0 ? 'start' : i === st.length - 1 ? 'end' : 'middle');
  const vals = st.map((s, i) => `<text class="v" x="${x(i).toFixed(1)}" y="${(y(s.v) - 12).toFixed(1)}" text-anchor="${anch(i)}">${Math.round(s.v / 100) / 10}k</text>`).join('');
  const yrs = st.map((s, i) => `<text x="${x(i).toFixed(1)}" y="${H - 14}" text-anchor="${anch(i)}">${s.y}</text>`).join('');
  const lbl = st.map((s, i) => `<text class="gl" x="${x(i).toFixed(1)}" y="${H - 2}" text-anchor="${anch(i)}">${s.l}</text>`).join('');
  return `<div class="panel wide">
    <div class="kick">צפי מחיר למ״ר · ${q.horizon}</div>
    <div class="big"><b>${nis(q.price)}</b><i>למ״ר בנוי</i></div>
    <div class="rng">טווח ${nis(q.low)} – ${nis(q.high)}</div>
    <div class="chart" style="margin-top:10px">
      <svg viewBox="0 0 ${W} ${H}" style="height:${H}px" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f0d089" stop-opacity=".40"/><stop offset="1" stop-color="#f0d089" stop-opacity="0"/>
        </linearGradient></defs>
        <line class="ax" x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}"/>
        ${band}
        <path class="ar2" d="${area}"/><path class="ln" d="${line}"/>
        ${pts}${vals}${yrs}${lbl}
      </svg>
    </div>
    <div class="chips">${(q.chips || []).map((c) => `<div class="chip"><b>${c.t}</b><span>${c.d}</span></div>`).join('')}</div>
    ${q.method ? `<div class="foot2">${q.method}</div>` : ''}
    ${q.conf ? `<span class="tag">${q.conf}</span>` : ''}
  </div>`;
}

/** the years and the forecast — big enough to read at a glance */
function chartHTML(n) {
  const W = 400, H = 186, PAD_L = 40, PAD_R = 12, PAD_T = 22, PAD_B = 26;
  const hist = n.series;
  const fc = n.forecast;
  const all = fc ? hist.concat([fc]) : hist;
  const vs = all.map((x) => x.v);
  const lo = Math.min(...vs) * 0.96, hi = Math.max(...vs) * 1.05;
  const x = (i) => PAD_L + (i * (W - PAD_L - PAD_R)) / (all.length - 1);
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const line = hist.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
  const area = line + ` L ${x(hist.length - 1).toFixed(1)} ${H - PAD_B} L ${x(0).toFixed(1)} ${H - PAD_B} Z`;
  const fcLine = fc ? `M ${x(hist.length - 1).toFixed(1)} ${y(hist[hist.length - 1].v).toFixed(1)} L ${x(all.length - 1).toFixed(1)} ${y(fc.v).toFixed(1)}` : '';
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  const grid = ticks.map((v) => `<line class="gr" x1="${PAD_L}" y1="${y(v).toFixed(1)}" x2="${W - PAD_R}" y2="${y(v).toFixed(1)}"/>` +
    `<text class="gl" x="${PAD_L - 7}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${Math.round(v / 1000)}k</text>`).join('');
  const pts = hist.map((p, i) => `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4.5"/>`).join('');
  const fcPt = fc ? `<circle class="pf" cx="${x(all.length - 1).toFixed(1)}" cy="${y(fc.v).toFixed(1)}" r="5"/>` : '';
  const yrs = all.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${p.y}</text>`).join('');
  const vals = all.map((p, i) => `<text class="v${fc && i === all.length - 1 ? ' vf' : ''}" x="${x(i).toFixed(1)}" y="${(y(p.v) - 11).toFixed(1)}" text-anchor="middle">${Math.round(p.v / 100) / 10}k</text>`).join('');
  const first = hist[0].v, last = hist[hist.length - 1].v;
  const rise = Math.round(((last / first) ** (1 / (hist.length - 1)) - 1) * 1000) / 10;
  return `<div class="chart">
    <div class="hd"><span>מחיר למ״ר · ${hist[0].y}–${hist[hist.length - 1].y}</span><b>${rise >= 0 ? '+' : ''}${rise}% לשנה בטווח</b></div>
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f0d089" stop-opacity=".45"/><stop offset="1" stop-color="#f0d089" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <line class="ax" x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}"/>
      <path class="ar" d="${area}"/><path class="ln" d="${line}"/>
      ${fcLine ? `<path class="fc" d="${fcLine}"/>` : ''}
      ${pts}${fcPt}${vals}${yrs}
    </svg>
    ${fc ? `<div class="note">הקו המקווקו — <b>תחזית ל-${fc.y}</b>, לפי ממוצע העלייה של העשור האחרון (${n.decade}% לשנה).${n.conf ? ' ' + n.conf + '.' : ''}</div>` : ''}
    ${n.src ? `<div class="srcline">${n.src}</div>` : ''}
  </div>`;
}
function buildParcels(F) {
  const g = S.layers.parcels.g;
  drawImageLayer('parcels', F.parcels && F.parcels.img);
  for (const p of (F.parcels && F.parcels.blocks) || []) {
    glowPath(g, p.poly, { close: true, w: 2.4, colour: '#ffffff', core: '#ffffff', glow: 2, dash: '14 10' });
    if (p.t) { const b2 = label(p.c, `<div class="card"><span class="nm">גוש ${p.t}</span></div>`, ''); b2.layer = 'parcels'; b2.prio = 7; }
  }
  for (const p of (F.parcels && F.parcels.plots) || []) {
    if (p.ours) {
      fillPoly(g, p.poly, { colour: '#ffc85a', opacity: 0.4 });
      glowPath(g, p.poly, { close: true, w: 4, colour: '#ffd479', core: '#fff3d2', glow: 4 });
      const o = label(p.c, `<div class="card"><span class="nm">גוש 6663 · חלקה 18</span><span class="un">החלקה שלנו · 21,265 מ"ר</span></div>`, 'pin plot');
      o.layer = 'parcels'; o.prio = 1; o.byFull = -104; o.by = -104;   // the card floats well above; the pin stays on the plot
    } else {
      glowPath(g, p.poly, { close: true, w: 1.4, colour: '#8fe3ff', core: '#dff4ff', glow: 1.8 });
    }
  }
}
function buildRoads(F) {
  for (const r of F.roads || []) {
    const sh = label(r.p, `<div class="card"><span class="nm">${r.t}</span></div>`, 'shield');
    sh.layer = 'roads'; sh.prio = 6;
  }
}

/* ---------------------------------------------------------------- loop */
function resize(first = false) {
  if (!stage.clientWidth || !stage.clientHeight) return;
  S.min = fitScale();
  S.max = PHONE ? Math.min(S.min * 4, 0.5) : Math.min(S.min * 7, 1);   // never raster the picture above its own resolution
  if (first || S.tScale < S.min) S.tScale = S.min;
  clamp();
  if (first) { S.scale = S.tScale; S.x = S.tx; S.y = S.ty; }
}
addEventListener('resize', () => { resize(); for (const r of S.labels) { r.w = 0; r.ow = 0; } relaxKick(); });
(function loop() {
  if (fly) stepFly(); else apply(0.3);
  requestAnimationFrame(loop);
})();

boot();
