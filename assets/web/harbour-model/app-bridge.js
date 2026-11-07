// THE HARBOUR · investment model, the app's side of it (2026-11-04).
//
// scripts/sync-harbour-model.mjs copies this file next to the model's index.html (assets/web/harbour-model/) and loads
// it BEFORE the model's own code. The model itself (labs/harbour-3d, demo.html) is not changed for the app; this file
// is the whole difference. It runs only when the page is framed (the shell's src/app/screens/harbour-model.ts); opened
// on its own it does nothing.
//
//   1. The calculator (the app's own harbour.html, framed by the model's unit page as harbour-model-calc.html, with the
//      Firebase write guard first in it) asks its parent for the live rates, a Save-As, a print and the booklet by
//      e-mail. Its parent is the model, which would answer the browser way (calc.ts: a download, a print frame, "no
//      mail"). In the app these go one level up to the shell instead, which answers them exactly as it answers
//      harbour.html (project-frame.ts: the main process fetches the rates, opens the native Save-As / print, sends the
//      mail); the answers come back down to the frame that asked. maoz-device stays the model's own answer.
//   2. The model's language follows the shell at open (?lang=), and a switch inside the model flips the shell too
//      (maoz-lang-set, as harbour.html's own chip does).
//   3. Esc on the building with nothing left to close (the model's own Esc changed nothing) leaves the model:
//      {type:'harbour-model-back'} to the shell, which returns to THE HARBOUR's menu.
//   4. {type:'harbour-model-ready'} once the building is on screen, so the shell knows the hand-over can start.
//   6. (2026-11-05) the admin lock: the same admin screen as the Harbour page's lock, alone, over the model (below).
(function () {
  'use strict';
  var parentWin = window.parent;
  if (!parentWin || parentWin === window) return;
  var SELF = location.origin;

  // ---------------------------------------------------------------- 6a. while the admin screen is open (section 6)
  // Registered first, so the model and section 3 never see a key meant for it: Esc asks the admin screen to close (it
  // asks first over unsaved changes), any other key does nothing here. Its messages: ready (shown), closed (taken away),
  // and its PC-name question (maoz-device), passed up to the shell as the Harbour page's own is, the answer back down.
  var adm = null; // {wrap, frame, ready, back}
  window.addEventListener('keydown', function (e) {
    if (!adm) return;
    e.stopImmediatePropagation(); e.stopPropagation();
    if (e.code !== 'Escape' && e.key !== 'Escape') return;
    e.preventDefault();
    if (adm.ready) admSay({ type: 'mza-solo-close' }); else closeAdmin();
  }, true);
  window.addEventListener('message', function (e) {
    if (!adm || e.source !== adm.frame.contentWindow || e.origin !== SELF) return;
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'mza-solo-ready') { adm.ready = true; adm.wrap.classList.add('ready'); adm.wrap.classList.toggle('flat', d.big === true); adm.wrap.classList.toggle('glass', d.big !== true); try { adm.frame.focus(); } catch (_) { /* */ } }
    else if (d.type === 'mza-solo-closed') closeAdmin();
    else if (d.type === 'maoz-device' && d.reqId != null) {
      e.stopImmediatePropagation();
      asked[d.reqId] = e.source;
      try { parentWin.postMessage(d, '*'); } catch (_) { /* */ }
    }
  }, true);

  // ---------------------------------------------------------------- 1. the calculator's requests, through the shell
  var UP = {
    'maoz-get-rates': 1, 'maoz-save-pdf': 1, 'maoz-print-pdf': 1,
    'maoz-mail-status': 1, 'maoz-mail-setup': 1, 'maoz-mail-send': 1,
  };
  var DOWN = /^(maoz-(?:save-pdf|print-pdf|mail-status|mail-setup|mail-send|device))-(ack|result)$/;
  var asked = Object.create(null); // reqId -> the frame that asked
  var rateAskers = [];
  function childFrame(w) {
    try { for (var i = 0; i < window.frames.length; i++) if (window.frames[i] === w) return true; } catch (_) { /* */ }
    return false;
  }
  function send(w, msg) { try { w.postMessage(msg, SELF); } catch (_) { /* the frame went away */ } }

  // capture phase, registered before the model's own code: at the target it runs first, and a request it takes up
  // never reaches the model's own browser answers
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (e.source === parentWin) {
      if (d.type === 'maoz-rates') { rateAskers.splice(0).forEach(function (w) { send(w, d); }); return; }
      var m = DOWN.exec(d.type);
      if (m && d.reqId != null && asked[d.reqId]) {
        var w = asked[d.reqId];
        if (m[2] === 'result') delete asked[d.reqId];
        send(w, d);
      }
      return;
    }
    if (!UP[d.type] || e.origin !== SELF || !e.source || e.source === window || !childFrame(e.source)) return;
    e.stopImmediatePropagation();
    if (d.type === 'maoz-get-rates') { if (rateAskers.indexOf(e.source) < 0) rateAskers.push(e.source); }
    else if (d.reqId != null) asked[d.reqId] = e.source;
    try { parentWin.postMessage(d, '*'); } catch (_) { /* */ }
  }, true);

  // ---------------------------------------------------------------- 2. the language, model -> shell
  var lastLang = document.documentElement.lang;
  new MutationObserver(function () {
    var l = document.documentElement.lang;
    if (l === lastLang || (l !== 'he' && l !== 'en')) return;
    lastLang = l;
    try { parentWin.postMessage({ type: 'maoz-lang-set', lang: l }, '*'); } catch (_) { /* */ }
    if (adm) { admSay({ type: 'mza-solo-lang', lang: l }); admTexts(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  // ---------------------------------------------------------------- 3. Esc at the top leaves the model
  function root() { return document.getElementById('dm'); }
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'Escape' && e.key !== 'Escape') return;
    var t = e.target;
    if (t && t.closest && t.closest('input, select, textarea')) return;
    var r = root();
    if (!r || r.dataset.state !== 'building') return;
    // whatever the model's own Esc does (close the menu, the name tag, a card) shows up as a change in the page; an
    // Esc that changed nothing at all, on the building, is one with nothing left to close
    var changed = false;
    var mo = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i].target;
        // the cursor follower and the live-status ticker move by themselves; they are not "something closed"
        if (n && n.nodeType === 1 && n.closest && n.closest('.sc-cursor, .dm-cursor')) continue;
        changed = true; return;
      }
    });
    mo.observe(r, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-expanded', 'data-state'] });
    window.setTimeout(function () {
      mo.disconnect();
      var rr = root();
      if (!changed && rr && rr.dataset.state === 'building') {
        try { parentWin.postMessage({ type: 'harbour-model-back' }, '*'); } catch (_) { /* */ }
      }
    }, 120);
  }, true);

  // ---------------------------------------------------------------- 5. "back to menu" in the model's own header
  // A button of the app's in the model's right-hand glass pill (beside HE/EN), drawn like its neighbours: back to THE
  // HARBOUR's menu from anywhere in the model. Put back if the page ever rebuilds its header.
  var BACK = { he: 'חזרה לתפריט', en: 'Back to menu' };
  var css = document.createElement('style');
  css.textContent = [
    '.hm-app-back{display:inline-flex;align-items:center;gap:.45em;white-space:nowrap;cursor:pointer}',
    '.hm-app-back svg{width:1.15em;height:1.15em;flex:none}',
    'html[dir="rtl"] .hm-app-back svg{transform:scaleX(-1)}',
    '.hm-app-back::after{content:"";width:1px;height:1.6em;margin-inline-start:.55em;background:currentColor;opacity:.22}',
    // 6. the admin lock: an icon only, quieter than its neighbours until pointed at; the admin screen's frame over all
    '.hm-app-lock{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;opacity:.55}',
    '.hm-app-lock:hover,.hm-app-lock:focus-visible{opacity:1}',
    '.hm-app-lock svg{width:1.2em;height:1.2em;flex:none;display:block}',
    // the veil: the model's own page cream, light, and the model blurred under it - the admin card (a cream glass card in
    // the frame, harbour-admin.js's solo look) sits on it as the model's own glass panels sit on the street. On a big
    // screen (the frame says html.big-screen: the TV) no blur, a denser veil instead. While it loads: a plain veil.
    '.hm-admin{position:fixed;inset:0;z-index:2147483000;background:rgba(243,239,223,.6)}',
    '.hm-admin.glass{background:rgba(243,239,223,.34);-webkit-backdrop-filter:blur(14px) saturate(1.15) brightness(1.06);backdrop-filter:blur(14px) saturate(1.15) brightness(1.06)}',
    '.hm-admin.flat{-webkit-backdrop-filter:none;backdrop-filter:none;background:rgba(243,239,223,.9)}',
    '.hm-admin-f{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;opacity:0}',
    '.hm-admin.ready .hm-admin-f{opacity:1}',
    '.hm-admin-wait{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#00291F;font:500 15px/1.4 Heebo,Assistant,sans-serif}',
    '.hm-admin-x{position:absolute;top:14px;inset-inline-end:14px;width:40px;height:40px;padding:0;border-radius:50%;border:1px solid rgba(200,169,107,.62);background:rgba(255,253,243,.66);color:#00291F;font:400 22px/1 sans-serif;cursor:pointer}',
    '.hm-admin.ready :is(.hm-admin-wait,.hm-admin-x){display:none}',
  ].join('\n');
  function backButton() {
    var nav = document.querySelector('#dm .dm-navp');
    if (!nav) return;
    var b = nav.querySelector('.hm-app-back');
    var l = document.documentElement.lang === 'en' ? 'en' : 'he';
    if (!b) {
      if (!css.isConnected) document.head.appendChild(css);
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'sc-nl hm-app-back';
      b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>';
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        try { parentWin.postMessage({ type: 'harbour-model-back' }, '*'); } catch (_) { /* */ }
      });
      nav.insertBefore(b, nav.firstChild);
    }
    var s = b.querySelector('span');
    if (s && s.textContent !== BACK[l]) { s.textContent = BACK[l]; b.title = BACK[l]; b.setAttribute('aria-label', BACK[l]); }
  }
  var backTimer = 0;
  new MutationObserver(function () {
    if (backTimer) return;
    backTimer = window.setTimeout(function () { backTimer = 0; backButton(); lockButton(); }, 50);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['lang'] });

  // ---------------------------------------------------------------- 4. ready = the building is on screen
  var readySent = false;
  function ready() {
    if (readySent) return;
    var r = root();
    if (!r || r.dataset.state !== 'building') return;
    readySent = true;
    try { parentWin.postMessage({ type: 'harbour-model-ready' }, '*'); } catch (_) { /* */ }
  }
  function watch() {
    var r = root();
    if (!r) return;
    new MutationObserver(ready).observe(r, { attributes: true, attributeFilter: ['data-state'] });
    ready();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();

  // ---------------------------------------------------------------- 5. the calculator full screen / a picture enlarged
  // (owner 2026-11-04) the model marks it html.dm-max (unitPage.syncMax); the shell hides its own chips meanwhile
  var maxOn = false;
  new MutationObserver(function () {
    var on = document.documentElement.classList.contains('dm-max');
    if (on === maxOn) return;
    maxOn = on;
    try { parentWin.postMessage({ type: 'harbour-model-max', on: on }, '*'); } catch (_) { /* */ }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // ---------------------------------------------------------------- 6. the admin lock (owner, 2026-11-05)
  // His words: "אני צריך מסך כניסה אחורי כמו שעשינו לי בתפריט מכירות הקודם עם המנעול בו אני יכול לשחרר ולסגור דירות
  // שנמכרו לבד גם בעמוד החדש בתוכנה". A discreet lock at the end of the header's glass pill opens THE SAME admin screen
  // as the lock on the Harbour page (assets/web/harbour-admin.js: his e-mail + password, statuses, prices, statistics,
  // log + undo), alone, over the model: a frame of the app's own ../harbour.html?admin=1 (harbour-admin.js's solo mode).
  // That is the real page, NOT the calculator copy - harbour-model-calc.html keeps its Firebase write guard and stays
  // read-only; the database's rules decide what the signed-in account may write. A change he saves reaches the model by
  // its own live read (src/live.ts), as it reaches every other device. Closing (×, Cancel, Esc, a tap beside the card)
  // takes the frame away and gives the focus back to the lock. tools/harbour-admin/DESIGN.md.
  var LOCK = { he: 'ניהול דירות', en: 'Apartment admin' };
  var WAIT = { he: 'פותח את מסך הניהול…', en: 'Opening the admin screen…' };
  var CLOSE = { he: 'סגירה', en: 'Close' };
  var LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>';
  function lang() { return document.documentElement.lang === 'en' ? 'en' : 'he'; }
  function lockButton() {
    var nav = document.querySelector('#dm .dm-navp');
    if (!nav) return;
    var b = nav.querySelector('.hm-app-lock');
    var l = lang();
    if (!b) {
      if (!css.isConnected) document.head.appendChild(css);
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'sc-nl hm-app-lock';
      b.innerHTML = LOCK_SVG;
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openAdmin(); });
      nav.appendChild(b);
    }
    if (b.title !== LOCK[l]) { b.title = LOCK[l]; b.setAttribute('aria-label', LOCK[l]); }
  }
  function admSay(msg) { try { if (adm && adm.frame.contentWindow) adm.frame.contentWindow.postMessage(msg, SELF); } catch (_) { /* */ } }
  function admTexts() {
    if (!adm) return;
    var l = lang();
    adm.wrap.setAttribute('dir', l === 'en' ? 'ltr' : 'rtl');
    adm.wrap.querySelector('.hm-admin-wait').textContent = WAIT[l];
    var x = adm.wrap.querySelector('.hm-admin-x');
    x.title = CLOSE[l]; x.setAttribute('aria-label', CLOSE[l]);
    adm.frame.title = LOCK[l];
  }
  function openAdmin() {
    if (adm) return;
    if (!css.isConnected) document.head.appendChild(css);
    var wrap = document.createElement('div');
    wrap.className = 'hm-admin';
    wrap.innerHTML = '<div class="hm-admin-wait" role="status"></div><button type="button" class="hm-admin-x">×</button>';
    var f = document.createElement('iframe');
    f.className = 'hm-admin-f';
    f.src = '../harbour.html?admin=1&lang=' + lang();
    wrap.appendChild(f);
    // until it is shown (a slow load, or one that never says ready): × or Esc leaves
    wrap.querySelector('.hm-admin-x').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeAdmin(); });
    adm = { wrap: wrap, frame: f, ready: false, back: document.activeElement };
    admTexts();
    document.body.appendChild(wrap);
    // the shell's own chips (language, home) step aside meanwhile, as for the calculator full screen (section 5)
    try { parentWin.postMessage({ type: 'harbour-model-max', on: true }, '*'); } catch (_) { /* */ }
    try { wrap.querySelector('.hm-admin-x').focus({ preventScroll: true }); } catch (_) { /* */ }
  }
  function closeAdmin() {
    if (!adm) return;
    var a = adm;
    adm = null;
    a.wrap.remove();   // the page unloads: its pagehide sends its last counts and closes its stream
    try { parentWin.postMessage({ type: 'harbour-model-max', on: document.documentElement.classList.contains('dm-max') }, '*'); } catch (_) { /* */ }
    var b = document.querySelector('#dm .dm-navp .hm-app-lock') || a.back;
    try { if (b && b.focus) b.focus({ preventScroll: true }); } catch (_) { /* */ }
  }
  lockButton();
})();
