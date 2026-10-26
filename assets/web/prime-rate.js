// The financing rates of the North Quarter and West calculators (his ask, 2026-10-26): before each annual-rate box
// sits a small "פריים +" checkbox. Unticked - the default - the box is the whole rate, exactly as before; ticked,
// the rate used is prime + the box. Prime = the Bank of Israel rate + 1.5, as in The Harbour's calculator: the page
// asks the app's shell ('maoz-get-rates' -> 'maoz-rates'; src/app/screens/project-frame.ts relays it to the main
// process, which reads the Bank of Israel without CORS) and also asks the Bank straight, which works where a page
// may (a plain browser). Without either - offline, or the web edition, which the Bank's API refuses - the default
// below is used, and the note under a ticked rate says it is the default.
//
// The page marks each pair: the checkbox is #<box id>Prime with data-prime-for="<box id>", inside a
// <label class="prime-tg">; a <div class="prime-eff" data-prime-for="<box id>"> under the row shows the rate used.
// The page reads MaozPrime.rate(id) for its math and MaozPrime.text(id) for its booklet, so the screen and the PDF
// always show the same number. Loaded by north-calc.html (scripts/edit-north-calc-tools.mjs, section 18) and
// west-calc.html (scripts/edit-west-calc-prime.mjs).
(function () {
  'use strict';
  if (window.MaozPrime) return;

  // the Bank of Israel rate 3.25% (its decision of 2026-10-21; the next is due 2026-11-23) + 1.5
  var DEFAULT_PRIME = 4.75;
  var st = { prime: DEFAULT_PRIME, live: false };

  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }   // the pages' getVal()
  // 6.25 / 4.875 - four places, so a sum prints as the math has it (a box of 0.125 is 4.875, not "4.88"); never "-0"
  function fmt(n) { var r = Math.round(n * 10000) / 10000; return String(r === 0 ? 0 : r); }
  function box(id) { return document.getElementById(id); }
  function chk(id) { return document.getElementById(id + 'Prime'); }
  function on(id) { var c = chk(id); return !!(c && c.checked); }
  function boxVal(id) { var b = box(id); return b ? num(b.value) : 0; }
  // the box as he typed it, without its sign ("0.125", "1.50"); a number typed another way (".5", "1e1") as its value
  function typed(id) {
    var b = box(id), t = b ? String(b.value || '').trim().replace(/^[-+]/, '') : '';
    return /^\d+(?:\.\d+)?$/.test(t) ? t : fmt(Math.abs(boxVal(id)));
  }

  // the annual rate in percent that the page's math uses. Ticked, prime + the box, never below 0: the pages'
  // compoundInterest() charges nothing for a rate of 0 or less anyway, so the rate shown is the rate used. Unticked,
  // the box exactly as before.
  function rate(id) { var v = boxVal(id); return on(id) ? Math.max(0, st.prime + v) : v; }
  // the same rate as the booklet prints it: "6%" (the box as typed, as it always was), or "פריים 4.75% + 1.5% = 6.25%"
  // (the box as typed, the sum as used); a box that takes prime below zero says what the math made of it:
  // "פריים 4.75% - 6% = -1.25% (0% בחישוב)"
  function text(id) {
    if (!on(id)) { var b = box(id); return (b ? String(b.value || '').trim() : '') + '%'; }
    var v = boxVal(id), sum = st.prime + v;
    return 'פריים ' + fmt(st.prime) + '% ' + (v < 0 ? '- ' : '+ ') + typed(id) + '% = ' + fmt(sum) + '%' + (sum < 0 ? ' (0% בחישוב)' : '');
  }

  function ids() {
    return Array.prototype.map.call(document.querySelectorAll('input[data-prime-for]'), function (c) { return c.getAttribute('data-prime-for'); });
  }
  // a new text node each time (not an edit of the old one): the page's English translator keeps the original of
  // every node it translated, and these only ever hold numbers anyway
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function refresh() {
    ids().forEach(function (id) {
      var c = chk(id), isOn = !!(c && c.checked);
      var tg = c && c.closest ? c.closest('.prime-tg') : null;
      if (tg) { tg.classList.toggle('on', isOn); setText(tg.querySelector('.prime-v'), '(' + fmt(st.prime) + '%)'); }
      var note = document.querySelector('.prime-eff[data-prime-for="' + id + '"]');
      if (note) {
        note.hidden = !isOn;
        setText(note.querySelector('.prime-eff-v'), fmt(rate(id)) + '%');
        var def = note.querySelector('.prime-def'); if (def) def.hidden = st.live;
      }
    });
  }
  function recalc() { if (typeof window.calculate === 'function') { try { window.calculate(); } catch (e) { /* the page's own */ } } }

  // a live prime: from the shell (the parent window only - no other frame sets the rate) or from the Bank itself
  function apply(p) {
    p = Number(p);
    if (!isFinite(p) || p <= 0 || p > 30) return;
    if (st.live && p === st.prime) return;
    st.prime = p; st.live = true;
    refresh(); recalc();
  }
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || d.type !== 'maoz-rates' || window.parent === window || e.source !== window.parent) return;
    if (d.prime != null) apply(d.prime);
  });
  function fetchLive() {
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'maoz-get-rates' }, '*'); } catch (e) { /* no shell */ }
    try {
      if (window.fetch) fetch('https://www.boi.org.il/PublicApi/GetInterest').then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.currentInterest != null) apply(Number(j.currentInterest) + 1.5); }).catch(function () { /* the default stays */ });
    } catch (e) { /* the default stays */ }
  }

  var CSS =
    '/* the "פריים +" checkbox before a financing rate box, and the rate used under the row (assets/web/prime-rate.js; colours from --pr-* on the page) */\n' +
    '.input-group label.prime-tg.prime-tg{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;width:auto;min-width:0;height:auto;min-height:30px;margin:0;padding:0 9px 0 8px;' +
      'border:1px solid var(--pr-line,rgba(45,106,79,.32));border-radius:999px;background:transparent;color:var(--pr-ink,#2D6A4F);font-size:12.5px;font-weight:600;line-height:1;' +
      'white-space:nowrap;overflow:visible;cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;box-sizing:border-box;opacity:.8;transition:opacity .2s,background-color .2s,border-color .2s}\n' +
    '.input-group label.prime-tg.prime-tg:hover{opacity:1;border-color:var(--pr-accent,#2D6A4F)}\n' +
    '.input-group label.prime-tg.prime-tg.on{opacity:1;background:var(--pr-fill,rgba(45,106,79,.1));border-color:var(--pr-accent,#2D6A4F)}\n' +
    '.prime-tg input[type=checkbox]{width:15px;height:15px;margin:0;padding:0;flex:none;accent-color:var(--pr-accent,#2D6A4F);cursor:pointer;transform:none}\n' +
    '.prime-tg .prime-v{font-weight:500;direction:ltr;unicode-bidi:isolate}\n' +
    '.prime-eff{margin:3px 0 7px;text-align:end;font-size:12.5px;line-height:1.3;color:var(--pr-ink,#2D6A4F)}\n' +
    '.prime-eff[hidden],.prime-eff .prime-def[hidden]{display:none}\n' +
    '.prime-eff .prime-eff-v{font-weight:700;direction:ltr;unicode-bidi:isolate}\n' +
    '.prime-eff .prime-def{opacity:.72}\n' +
    '/* a finger: a bigger box and pill, and a hit area a little beyond the pill (a click on the label\'s ::before is a\n' +
    '   click on the label) - the North sheet is drawn at ~63% on a phone, so its 34px pill alone would be ~21px there */\n' +
    '@media (pointer: coarse){.input-group label.prime-tg.prime-tg{position:relative;min-height:34px;padding:0 11px 0 10px}' +
      '.input-group label.prime-tg.prime-tg::before{content:"";position:absolute;inset:-6px -5px}.prime-tg input[type=checkbox]{width:18px;height:18px}}\n' +
    '@media print{.input-group label.prime-tg.prime-tg{opacity:1}}\n';
  function style() {
    if (document.getElementById('prime-rate-css')) return;
    var s = document.createElement('style'); s.id = 'prime-rate-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function init() {
    style();
    ids().forEach(function (id) {
      var c = chk(id), b = box(id);
      if (c) c.addEventListener('change', function () { refresh(); recalc(); });
      if (b) b.addEventListener('input', refresh);
    });
    refresh();
    fetchLive();
  }

  window.MaozPrime = {
    DEFAULT: DEFAULT_PRIME,
    rate: rate, text: text, refresh: refresh, isOn: on,
    prime: function () { return st.prime; },
    isLive: function () { return st.live; },
    // "שחזר ברירות מחדל": every checkbox off - the boxes are the whole rate again
    reset: function () { ids().forEach(function (id) { var c = chk(id); if (c) c.checked = false; }); refresh(); },
  };
  style();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
