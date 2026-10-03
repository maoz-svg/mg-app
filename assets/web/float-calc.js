/* A small arithmetic calculator in a floating glass window (his ask, 2026-10-03): opened from a
   "מחשבון" button in the investment calculator, dragged by its title bar, closed with ×. It works
   with the mouse and the keyboard (digits, + - * /, %, Enter, Backspace, Escape) and evaluates the
   whole expression with the usual precedence - no eval. Plain ES5: it runs inside the project
   documents. The look is the glass he approved for the Harbour dialogs; the only animated
   properties are opacity and transform (the style guard refuses painted-property transitions).

   window.MaozFloatCalc.open() / .close() / .toggle(); .button(label) returns a ready button. */
(function () {
  'use strict';
  if (window.MaozFloatCalc) return;

  var CSS = [
    '#mzCalc{position:fixed;z-index:100002;width:268px;direction:ltr;user-select:none;-webkit-user-select:none;',
    // glass tinted with the calculator page's own deep green: over the cream sheet a neutral glass read
    // as grey and the white digits went faint
    'border-radius:18px;border:1px solid rgba(216,180,106,.5);background:linear-gradient(165deg,rgba(16,52,40,.74),rgba(8,30,23,.82));',
    '-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 30px 70px -24px rgba(0,0,0,.75);',
    'font-family:"Heebo","Assistant",sans-serif;color:#eef3f7;opacity:0;transform:translateY(6px) scale(.98);pointer-events:none;transition:opacity .18s ease,transform .18s ease}',
    '#mzCalc.open{opacity:1;transform:none;pointer-events:auto}',
    '#mzCalc .mc-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px 14px;cursor:grab;touch-action:none}',
    '#mzCalc.dragging .mc-bar{cursor:grabbing}',
    '#mzCalc .mc-title{font-size:13px;letter-spacing:.08em;color:#e7d3a6;direction:rtl}',
    '#mzCalc .mc-x{width:26px;height:26px;border-radius:50%;border:1px solid rgba(216,180,106,.4);background:rgba(255,255,255,.06);color:#f0e9d8;font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}',
    '#mzCalc .mc-screen{margin:4px 12px 10px;padding:10px 12px;border-radius:12px;background:rgba(4,12,20,.35);border:1px solid rgba(255,255,255,.08);text-align:right;min-height:58px}',
    '#mzCalc .mc-expr{font-size:12.5px;color:rgba(231,211,166,.8);min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr}',
    '#mzCalc .mc-out{font-size:26px;font-weight:500;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;direction:ltr}',
    '#mzCalc .mc-keys{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;padding:0 12px 12px}',
    '#mzCalc .mc-k{height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.07);color:#f3f6f8;font:500 17px "Heebo","Assistant",sans-serif;cursor:pointer;padding:0}',
    '#mzCalc .mc-k:hover{background:rgba(255,255,255,.13)}',
    '#mzCalc .mc-k:active{background:rgba(255,255,255,.18)}',
    '#mzCalc .mc-op{color:#e7c98c;background:rgba(216,180,106,.12);border-color:rgba(216,180,106,.28)}',
    '#mzCalc .mc-fn{color:#cfd9e2}',
    '#mzCalc .mc-eq{background:#d8b46a;color:#0b1d2e;border-color:#d8b46a;font-weight:700}',
    '#mzCalc .mc-zero{grid-column:span 2}',
    '#mzCalc .mc-k:focus-visible,#mzCalc .mc-x:focus-visible{outline:2px solid rgba(233,193,121,.85);outline-offset:1px}',
    '#mzCalc .mc-screen.mc-flash{border-color:rgba(233,193,121,.9);background:rgba(216,180,106,.16)}',
    '#mzCalc .mc-hint{padding:0 14px 12px;font-size:11px;line-height:1.4;color:rgba(231,211,166,.72);direction:rtl;text-align:center}',
    '.mz-picked{outline:2px solid rgba(216,180,106,.95)!important;outline-offset:2px;border-radius:4px}',
    '.mz-calc-btn{cursor:pointer}',
    'html.mini-cursor-on #mzCalc .mc-k,html.mini-cursor-on #mzCalc .mc-x,html.mini-cursor-on .mz-calc-btn{cursor:pointer!important}',
    '@media (prefers-reduced-motion:reduce){#mzCalc{transition:none}}'
  ].join('');

  var KEYS = [
    ['C', 'fn', 'clear'], ['⌫', 'fn', 'back'], ['%', 'fn', 'pct'], ['÷', 'op', '/'],
    ['7', '', '7'], ['8', '', '8'], ['9', '', '9'], ['×', 'op', '*'],
    ['4', '', '4'], ['5', '', '5'], ['6', '', '6'], ['−', 'op', '-'],
    ['1', '', '1'], ['2', '', '2'], ['3', '', '3'], ['+', 'op', '+'],
    ['0', 'zero', '0'], ['.', '', '.'], ['=', 'eq', '=']
  ];

  var el = null, expr = '', last = null, justEvaluated = false;

  // ---- the arithmetic: tokens -> shunting-yard -> value; % applies to the number before it
  function tokenize(s) {
    var out = [], i = 0, num = '';
    while (i < s.length) {
      var c = s.charAt(i);
      if (/[0-9.]/.test(c)) { num += c; i++; continue; }
      if (num) { out.push(parseFloat(num)); num = ''; }
      if (c === '%') { if (typeof out[out.length - 1] === 'number') out[out.length - 1] = out[out.length - 1] / 100; i++; continue; }
      if ('+-*/'.indexOf(c) >= 0) {
        // a leading minus, or one after an operator, belongs to the number
        if (c === '-' && (out.length === 0 || typeof out[out.length - 1] === 'string')) { num = '-'; i++; continue; }
        out.push(c);
      }
      i++;
    }
    if (num && num !== '-') out.push(parseFloat(num));
    return out;
  }
  function evaluate(s) {
    var t = tokenize(s), prec = { '+': 1, '-': 1, '*': 2, '/': 2 }, vals = [], ops = [];
    function apply() {
      var b = vals.pop(), a = vals.pop(), o = ops.pop();
      if (a === undefined || b === undefined) throw new Error('syntax');
      if (o === '/' && b === 0) throw new Error('div0');
      vals.push(o === '+' ? a + b : o === '-' ? a - b : o === '*' ? a * b : a / b);
    }
    while (t.length && typeof t[t.length - 1] === 'string') t.pop();   // a trailing operator is ignored
    for (var i = 0; i < t.length; i++) {
      var x = t[i];
      if (typeof x === 'number') { if (isNaN(x)) throw new Error('syntax'); vals.push(x); continue; }
      while (ops.length && prec[ops[ops.length - 1]] >= prec[x]) apply();
      ops.push(x);
    }
    while (ops.length) apply();
    if (vals.length !== 1) throw new Error('syntax');
    return vals[0];
  }
  function fmt(n) {
    if (!isFinite(n)) return 'שגיאה';
    var r = Math.round(n * 1e10) / 1e10;
    var abs = Math.abs(r);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return r.toExponential(6);
    var parts = String(r).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function pretty(s) {
    return s.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\+/g, ' + ').replace(/(\d|%)-/g, '$1 − ')
      .replace(/(\d+(?:\.\d*)?)/g, function (m) { var p = m.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return p.join('.'); });
  }

  function render() {
    if (!el) return;
    var out = el.querySelector('.mc-out'), ex = el.querySelector('.mc-expr');
    if (justEvaluated && last !== null) { ex.textContent = pretty(expr) + ' ='; out.textContent = fmt(last); return; }
    ex.textContent = '';
    var shown = expr ? pretty(expr) : '0';
    out.textContent = shown;
    try { if (/[+\-*/%]/.test(expr.replace(/^-/, ''))) ex.textContent = '= ' + fmt(evaluate(expr)); } catch (e) { /* incomplete */ }
  }
  function press(v) {
    if (v === 'clear') { expr = ''; last = null; justEvaluated = false; return render(); }
    if (v === 'back') { if (justEvaluated) { justEvaluated = false; expr = last !== null ? String(last) : ''; } expr = expr.slice(0, -1); return render(); }
    if (v === '=') {
      if (!expr) return;
      try { last = evaluate(expr); justEvaluated = true; } catch (e) { last = NaN; justEvaluated = true; }
      return render();
    }
    if (justEvaluated) {
      // after "=", an operator continues from the result; a digit starts afresh
      expr = /[+\-*/%]/.test(v) && last !== null && isFinite(last) ? String(Math.round(last * 1e10) / 1e10) : '';
      justEvaluated = false;
    }
    if (v === 'pct') v = '%';
    var tail = expr.slice(-1);
    if ('+-*/'.indexOf(v) >= 0) {
      if (!expr && v !== '-') return render();
      if ('+-*/'.indexOf(tail) >= 0) { expr = expr.slice(0, -1); if (!expr && v !== '-') return render(); }
    }
    if (v === '%' && !/[0-9.]/.test(tail)) return render();
    if (v === '.') {
      var cur = expr.split(/[+\-*/%]/).pop();
      if (cur.indexOf('.') >= 0) return render();
      if (!cur) v = '0.';
    }
    if (expr.length > 60) return render();
    expr += v;
    render();
  }

  function build() {
    if (el) return el;
    if (!document.getElementById('mzCalcCss')) {
      var st = document.createElement('style'); st.id = 'mzCalcCss'; st.textContent = CSS; document.head.appendChild(st);
    }
    el = document.createElement('div');
    el.id = 'mzCalc';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'מחשבון');
    var keys = KEYS.map(function (k) {
      var cls = 'mc-k' + (k[1] === 'op' ? ' mc-op' : k[1] === 'fn' ? ' mc-fn' : k[1] === 'eq' ? ' mc-eq' : k[1] === 'zero' ? ' mc-zero' : '');
      return '<button type="button" class="' + cls + '" data-v="' + k[2] + '">' + k[0] + '</button>';
    }).join('');
    el.innerHTML = '<div class="mc-bar"><button type="button" class="mc-x" aria-label="סגירה" title="סגירה">×</button><span class="mc-title">מחשבון</span></div>' +
      '<div class="mc-screen"><div class="mc-expr"></div><div class="mc-out">0</div></div><div class="mc-keys">' + keys + '</div>' +
      '<div class="mc-hint">לחיצה על מספר בדף מכניסה אותו לכאן</div>';
    document.body.appendChild(el);
    // place it: the last spot he left it this session, else the upper right of the page
    var pos = null;
    try { pos = JSON.parse(sessionStorage.getItem('mz-calc-pos') || 'null'); } catch (e) { /* private mode */ }
    place(pos ? pos.x : window.innerWidth - 268 - 40, pos ? pos.y : 90);

    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-v]');
      if (b) { press(b.getAttribute('data-v')); return; }
      if (e.target.closest && e.target.closest('.mc-x')) close();
    });
    // drag by the title bar: pointer capture, kept inside the window
    var bar = el.querySelector('.mc-bar'), drag = null;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.mc-x')) return;
      var r = el.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      el.classList.add('dragging');
      e.preventDefault();
    });
    bar.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      place(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    function endDrag() {
      if (!drag) return;
      drag = null; el.classList.remove('dragging');
      try { sessionStorage.setItem('mz-calc-pos', JSON.stringify({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) })); } catch (e) { /* private mode */ }
    }
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', function () { if (el) place(parseFloat(el.style.left), parseFloat(el.style.top)); });
    document.addEventListener('keydown', onKey, true);
    return el;
  }
  function place(x, y) {
    var w = el.offsetWidth || 268, h = el.offsetHeight || 380;
    x = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8));
    y = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8));
    el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
  }
  function isOpen() { return !!(el && el.classList.contains('open')); }

  /* ---- a number off the page (his ask, 2026-10-03): while the calculator is open, a click on a
     value in the page behind it - an input, or a cell whose text is a figure - puts that figure
     into the calculator. A number already being typed is replaced, as when typing a new one; after
     an operator it is appended; after "=" it starts afresh. The click itself is left alone, so an
     input still takes the focus. */
  var NUMRX = /-?\d[\d,]*(?:\.\d+)?/;
  function numberIn(text) {
    var t = String(text || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
    if (!t || t.length > 40) return null;
    var m = t.match(NUMRX);
    if (!m) return null;
    // the figure must be most of what is there: a label with a number inside it is not a value
    var rest = t.replace(m[0], '').replace(/מ["״]ר|יח["״]ד|שנים|שנה|דונם|חודשים|[\s₪€$%()+\-–·.,:\/=×]/g, '');
    if (rest.length > 3) return null;
    var n = parseFloat(m[0].replace(/,/g, ''));
    if (/^\(.*\)$/.test(t) && n > 0) n = -n;   // an accounting negative
    return isFinite(n) ? n : null;
  }
  function pickFrom(target) {
    if (!target || target.nodeType !== 1 || (el && el.contains(target))) return null;
    if (target.tagName === 'INPUT') {
      if (!/^(text|number|tel|)$/i.test(target.type || '')) return null;
      var v = numberIn(target.value);
      return v === null ? null : { n: v, node: target };
    }
    if (target.closest && target.closest('button,select,textarea,a,label,summary,h1,h2,h3')) return null;
    var node = target;
    for (var hops = 0; node && node !== document.body && hops < 3; hops++, node = node.parentElement) {
      if (node.childElementCount > 3) break;
      var n = numberIn(node.textContent);
      if (n !== null) return { n: n, node: node };
    }
    return null;
  }
  function insertNumber(n) {
    if (justEvaluated) { expr = ''; justEvaluated = false; last = null; }
    var m = expr.match(/[0-9.]+%?$/);
    if (m) { expr = expr.slice(0, -m[0].length); if (/(^|[+\-*/])-$/.test(expr)) expr = expr.slice(0, -1); }
    expr += String(Math.round(n * 1e10) / 1e10);
    render();
    var scr = el.querySelector('.mc-screen');
    scr.classList.add('mc-flash'); setTimeout(function () { scr.classList.remove('mc-flash'); }, 260);
  }
  document.addEventListener('click', function (e) {
    if (!isOpen()) return;
    var hit = pickFrom(e.target);
    if (!hit) return;
    insertNumber(hit.n);
    hit.node.classList.add('mz-picked');
    setTimeout(function () { hit.node.classList.remove('mz-picked'); }, 650);
  }, true);
  // the keyboard drives it while it is open, unless he is typing in a field of the page
  function onKey(e) {
    if (!isOpen()) return;
    var t = e.target, tag = t && t.tagName;
    if ((tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) && !(el.contains(t))) return;
    var k = e.key, map = { Enter: '=', '=': '=', Backspace: 'back', Delete: 'clear', '%': 'pct', ',': '.' };
    if (k === 'Escape') { close(); e.preventDefault(); return; }
    var v = map[k] || (/^[0-9.+\-*/]$/.test(k) ? k : null);
    if (v === null) return;
    e.preventDefault(); e.stopPropagation();
    press(v);
  }
  function open() { build(); el.classList.add('open'); render(); place(parseFloat(el.style.left), parseFloat(el.style.top)); }
  function close() { if (el) el.classList.remove('open'); }
  function toggle() { if (isOpen()) close(); else open(); }
  function button(label, cls) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = (cls ? cls + ' ' : '') + 'mz-calc-btn'; b.textContent = label || 'מחשבון';
    b.addEventListener('click', toggle);
    return b;
  }
  window.MaozFloatCalc = { open: open, close: close, toggle: toggle, button: button, _eval: evaluate, _fmt: fmt, _num: numberIn };
})();
