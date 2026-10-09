/* "Send the booklet by e-mail" for a project calculator, as a self-contained module (2026-10-03).
   The Harbour calculator has the same flow baked in (scripts/edit-harbour-mail-send.mjs, with its
   extra apartment booklets); this is that flow without the apartment chooser, for the North
   Quarter and any later project:

     export -> "send by e-mail?" -> (once per PC: the shell's app-password card) -> one person or
     several, and for one a man or a woman -> names, customer addresses, extra addresses ->
     preview (subject, attachments, the editable letter, the signature card) -> send from
     info@maoz-group.com -> success, or a failure card with retry / set up again.
   Any cancel offers to save the booklet instead.

   The document talks to the shell by postMessage (maoz-mail-status / -setup / -send), the shell to
   main (electron/mail.cjs). Where there is no shell bridge (the browser edition) probe() says so and
   the caller simply saves the file as before. The letter HTML and the signature constants come from
   window.MAOZ_MAIL_TEMPLATE (harbour-mail-template.js); the letter text from opts.compose.

   window.MaozMailFlow.probe(cb)            -> cb(available)
   window.MaozMailFlow.run(opts)            -> Promise, resolves when the flow is over
     opts = { bytes: ArrayBuffer, fileName, label (what the booklet is, for the dialogs),
              compose({names, number, gender}) -> {subject, text},
              deck: false | 'north' | 'harbour', saveAs: function () }
   Plain ES5. */
(function () {
  'use strict';
  if (window.MaozMailFlow) return;

  var CSS = [
    '.mf-overlay{position:fixed;inset:0;z-index:100000;background:rgba(6,16,12,.75);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;opacity:0;visibility:hidden;transition:opacity .25s;direction:rtl}',
    '.mf-overlay.open{opacity:1;visibility:visible}',
    '.mf-card{background:linear-gradient(165deg,rgba(17,38,60,.18),rgba(10,24,40,.24));-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgba(216,180,106,.4);border-radius:20px;padding:26px 28px;max-width:520px;width:92vw;max-height:92vh;overflow:auto;text-align:right;box-shadow:0 40px 80px -20px rgba(0,0,0,.7);color:#e8eef2;font-family:"Heebo","Assistant",sans-serif}',
    '.mf-card.mf-wide{max-width:640px}',
    '.mf-card h3{font-family:"Cormorant Garamond","Frank Ruhl Libre",serif;font-style:italic;font-weight:600;font-size:22px;color:#f0e9d8;margin:0 0 10px}',
    '.mf-card p{font-size:14.5px;line-height:1.55;color:#cfd9e2;margin:0 0 14px}',
    '.mf-btns{display:flex;gap:12px;justify-content:center;margin-top:14px;flex-wrap:wrap}',
    '.mf-btn{font-family:"Heebo","Assistant",sans-serif;font-size:15px;font-weight:600;padding:9px 26px;border-radius:12px;cursor:pointer}',
    '.mf-yes{background:#d8b46a;color:#0b1d2e;border:1px solid #d8b46a}',
    '.mf-yes:disabled{opacity:.5;cursor:default}',
    '.mf-no{background:rgba(255,255,255,.06);color:#e8eef2;border:1px solid rgba(216,180,106,.45)}',
    '.mf-pills{display:flex;gap:10px;justify-content:center;margin:10px 0}',
    '.mf-opt{font-family:"Heebo","Assistant",sans-serif;font-size:15px;font-weight:600;color:#e7d3a6;background:rgba(255,255,255,.06);border:1px solid rgba(216,180,106,.35);border-radius:30px;padding:10px 18px;cursor:pointer}',
    '.mf-opt.on{background:#d8b46a;color:#0b1d2e;border-color:#d8b46a}',
    '.mf-hidden{display:none}',
    '.mf-sample{min-height:20px;text-align:center;font-size:14px;color:#e7d3a6}',
    '.mf-lbl{display:block;margin:10px 0 4px;font-size:13px;color:#e7d3a6}',
    '.mf-input{width:100%;box-sizing:border-box;padding:9px 12px;border-radius:10px;border:1px solid rgba(216,180,106,.5);background:rgba(255,255,255,.07);color:#fff;font:15px "Heebo","Assistant",sans-serif;outline:none}',
    '.mf-input:focus{border-color:#d8b46a}',
    '.mf-input[dir="ltr"]{text-align:left}',
    '.mf-err{min-height:18px;color:#e07b7b;font-size:13px;margin:8px 0 0}',
    '.mf-meta{font-size:13px;color:#cfd9e2;margin:0 0 6px}',
    '.mf-att{font-size:13px;color:#cfd9e2;margin:0 0 10px;line-height:1.6}',
    '.mf-body{width:100%;box-sizing:border-box;min-height:260px;padding:10px 12px;border-radius:10px;border:1px solid rgba(216,180,106,.5);background:rgba(255,255,255,.07);color:#fff;font:14px/1.55 "Heebo","Assistant",sans-serif;direction:rtl;text-align:right;resize:vertical;outline:none}',
    '.mf-body:focus{border-color:#d8b46a}',
    '.mf-sig{margin:2px 0 4px}',
    '.mf-sig img{display:block;width:260px;max-width:100%;height:auto;border-radius:6px;border:1px solid rgba(216,180,106,.35)}',
    '.mf-link{background:none;border:0;color:rgba(240,233,216,.6);font-size:13px;text-decoration:underline;cursor:pointer;font-family:"Heebo","Assistant",sans-serif;padding:0}',
    '#mfVeil{position:fixed;inset:0;z-index:100001;display:none;align-items:center;justify-content:center;background:rgba(6,16,12,.82);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#f0e9d8;font:600 18px "Heebo","Assistant",sans-serif;text-align:center;padding:20px;outline:none;direction:rtl}',
    '#mfVeil.open{display:flex}',
    '@media (max-width:600px){.mf-card{width:94vw;max-width:94vw;padding:20px 16px}}',
    'html.mini-cursor-on .mf-btn,html.mini-cursor-on .mf-opt,html.mini-cursor-on .mf-link{cursor:pointer!important}'
  ].join('');
  function css() { if (!document.getElementById('mfCss')) { var s = document.createElement('style'); s.id = 'mfCss'; s.textContent = CSS; document.head.appendChild(s); } }

  /* ---- talking to the shell ---- */
  function relay(type, payload, onResult, onNoAck) {
    if (!(window.parent && window.parent !== window)) { onNoAck(); return; }
    var reqId = type + '-' + Math.random().toString(36).slice(2) + String(+new Date()), gotAck = false;
    var ackTimer = setTimeout(function () { if (!gotAck) { window.removeEventListener('message', onMsg); onNoAck(); } }, 500);
    function onMsg(ev) {
      var d = ev && ev.data;
      if (!d || d.reqId !== reqId) return;
      if (d.type === type + '-ack') { gotAck = true; clearTimeout(ackTimer); }
      else if (d.type === type + '-result') { window.removeEventListener('message', onMsg); clearTimeout(ackTimer); onResult(d); }
    }
    window.addEventListener('message', onMsg);
    var msg = { type: type, reqId: reqId };
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
    window.parent.postMessage(msg, '*');
  }
  var avail = null, probed = false;
  function probe(cb) {
    if (probed) { cb(avail); return; }
    relay('maoz-mail-status', {}, function (d) { probed = true; avail = (d && d.ok && d.result) ? d.result : null; cb(avail); },
      function () { probed = true; avail = null; cb(null); });
  }
  // a long watchdog: a big mail on a slow line takes minutes, and a second send must never start
  function mailRelay(type, payload, ms) {
    return new Promise(function (res) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; res({ ok: false, error: 'timeout' }); } }, ms || 600000);
      relay(type, { payload: payload }, function (d) { if (!done) { done = true; clearTimeout(t); res(d); } },
        function () { if (!done) { done = true; clearTimeout(t); res({ ok: false, error: 'no bridge' }); } });
    });
  }

  /* ---- the dialogs: one overlay, its card rebuilt per step ---- */
  function dialog(html, wire, wide) {
    css();
    return new Promise(function (resolve) {
      var ov = document.getElementById('mfOverlay');
      if (!ov) { ov = document.createElement('div'); ov.id = 'mfOverlay'; ov.className = 'mf-overlay'; document.body.appendChild(ov); }
      ov.innerHTML = '<div class="mf-card' + (wide ? ' mf-wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
      var card = ov.firstChild, closed = false;
      function close(v) { if (closed) return; closed = true; ov.classList.remove('open'); document.removeEventListener('keydown', onKey, true); ov.onclick = null; resolve(v); }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } }
      document.addEventListener('keydown', onKey, true);
      ov.onclick = function (e) { if (e.target === ov) close(null); };
      Array.prototype.forEach.call(card.querySelectorAll('[data-cancel]'), function (b) { b.addEventListener('click', function () { close(null); }); });
      wire(card, close);
      ov.classList.add('open');
      var f = card.querySelector('input,textarea'); if (f) setTimeout(function () { try { f.focus(); } catch (e) { /* gone */ } }, 80);
    });
  }
  function veil(text) {
    css();
    var v = document.getElementById('mfVeil');
    if (!v) { v = document.createElement('div'); v.id = 'mfVeil'; v.tabIndex = -1; v.addEventListener('keydown', function (e) { e.preventDefault(); }); document.body.appendChild(v); }
    if (text === null) { v.classList.remove('open'); return; }
    v.textContent = text; v.classList.add('open'); try { v.focus(); } catch (e) { /* gone */ }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'; }); }
  function ltr(s) { return '<span dir="ltr" style="unicode-bidi:isolate">' + esc(s) + '</span>'; }
  function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }
  function card(html, buttons) {
    return dialog(html + '<div class="mf-btns">' + buttons.map(function (b, i) { return '<button type="button" class="mf-btn ' + (i === 0 ? 'mf-yes' : 'mf-no') + '" data-i="' + i + '">' + b.label + '</button>'; }).join('') + '</div>',
      function (c, close) { Array.prototype.forEach.call(c.querySelectorAll('[data-i]'), function (b) { b.onclick = function () { close(buttons[+b.getAttribute('data-i')].value); }; }); });
  }

  function askSend(o) {
    return dialog('<h3>לשלוח את החוברת במייל?</h3><p>' + esc(o.label) + ' מוכנה. אפשר לשלוח אותה ללקוח ישירות מהתיבה ' + ltr('info@maoz-group.com') + (o.deck ? ', יחד עם מצגת המשקיעים' : '') + '.</p>' +
      '<div class="mf-btns"><button type="button" class="mf-btn mf-yes" data-v="yes">כן, לשלוח במייל</button><button type="button" class="mf-btn mf-no" data-v="no">לא, רק לשמור</button></div>',
      function (c, close) { c.querySelector('[data-v="yes"]').onclick = function () { close('yes'); }; c.querySelector('[data-v="no"]').onclick = function () { close('no'); }; });
  }
  function askWho() {
    return dialog('<h3>למי מופנה המייל?</h3>' +
      '<div class="mf-pills"><button type="button" class="mf-opt" data-num="s">לשון יחיד</button><button type="button" class="mf-opt" data-num="p">לשון רבים</button></div>' +
      '<div class="mf-pills mf-hidden" id="mfGen"><button type="button" class="mf-opt" data-gen="m">זכר</button><button type="button" class="mf-opt" data-gen="f">נקבה</button></div>' +
      '<p class="mf-sample" id="mfSample"></p>' +
      '<div class="mf-btns"><button type="button" class="mf-btn mf-yes" id="mfWhoGo" disabled>המשך</button><button type="button" class="mf-btn mf-no" data-cancel>ביטול</button></div>',
      function (c, close) {
        var num = null, gen = null, go = c.querySelector('#mfWhoGo'), sample = c.querySelector('#mfSample');
        function paint() {
          Array.prototype.forEach.call(c.querySelectorAll('[data-num]'), function (b) { b.classList.toggle('on', b.getAttribute('data-num') === num); });
          Array.prototype.forEach.call(c.querySelectorAll('[data-gen]'), function (b) { b.classList.toggle('on', b.getAttribute('data-gen') === gen); });
          c.querySelector('#mfGen').classList.toggle('mf-hidden', num !== 's');
          var ready = num === 'p' || (num === 's' && !!gen);
          go.disabled = !ready;
          sample.textContent = ready ? ('הפתיחה תהיה: היי … ' + (num === 'p' ? 'היקרים' : (gen === 'f' ? 'היקרה' : 'היקר')) + ',') : '';
        }
        Array.prototype.forEach.call(c.querySelectorAll('[data-num]'), function (b) { b.onclick = function () { num = b.getAttribute('data-num'); if (num === 'p') gen = null; paint(); }; });
        Array.prototype.forEach.call(c.querySelectorAll('[data-gen]'), function (b) { b.onclick = function () { gen = b.getAttribute('data-gen'); paint(); }; });
        go.onclick = function () { if (!go.disabled) close({ number: num, gender: gen || 'm' }); };
        paint();
      });
  }
  function parseAddrs(s) { return String(s || '').split(/[\s,;]+/).map(function (a) { return a.trim(); }).filter(Boolean); }
  var ADDR = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function askRecipients(who, prev) {
    var plural = who.number === 'p', female = who.gender === 'f';
    return dialog('<h3>פרטי הנמענים</h3>' +
      '<label class="mf-lbl">' + (plural ? 'שמות הנמענים כפי שיופיעו בפתיחה' : 'שם הנמען כפי שיופיע בפתיחה') + '</label><input class="mf-input" id="mfNames" dir="rtl" autocomplete="off" placeholder="' + (plural ? 'יחיאל ורחל' : (female ? 'יהל' : 'יחיאל')) + '" value="' + esc(prev && prev.names || '') + '">' +
      '<label class="mf-lbl">' + (plural ? 'כתובות המייל של הלקוחות' : (female ? 'כתובת המייל של הלקוחה' : 'כתובת המייל של הלקוח')) + '</label><input class="mf-input" id="mfTo" dir="ltr" type="text" autocomplete="off" inputmode="email" placeholder="name@example.com" value="' + esc(prev && prev.to ? prev.to.join(', ') : '') + '">' +
      '<label class="mf-lbl">מיילים נוספים (עותק)</label><input class="mf-input" id="mfCc" dir="ltr" type="text" autocomplete="off" inputmode="email" placeholder="lawyer@example.com, partner@example.com" value="' + esc(prev && prev.cc ? prev.cc.join(', ') : '') + '">' +
      '<p class="mf-err" id="mfErr"></p>' +
      '<div class="mf-btns"><button type="button" class="mf-btn mf-yes" id="mfRecGo">המשך</button><button type="button" class="mf-btn mf-no" data-cancel>ביטול</button></div>',
      function (c, close) {
        var err = c.querySelector('#mfErr');
        function go() {
          var names = c.querySelector('#mfNames').value.replace(/\s+/g, ' ').replace(/[\s,.]+$/, '').trim();
          var to = parseAddrs(c.querySelector('#mfTo').value), cc = parseAddrs(c.querySelector('#mfCc').value);
          if (!names) { err.textContent = 'יש להזין שם'; return; }
          if (!to.length) { err.textContent = 'יש להזין כתובת מייל של הלקוח'; return; }
          var bad = to.concat(cc).filter(function (a) { return !ADDR.test(a); })[0];
          if (bad) { err.textContent = 'כתובת לא תקינה: ' + bad; return; }
          close({ names: names, to: to, cc: cc });
        }
        c.querySelector('#mfRecGo').onclick = go;
        Array.prototype.forEach.call(c.querySelectorAll('input'), function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } }); });
      });
  }
  var DECK_MB = { harbour: 5331159, north: 3236146 };
  function askPreview(ctx, letter) {
    // a Hebrew file name keeps its own direction (inside a left-to-right span its ".pdf" jumped)
    function name(s) { return '<span dir="auto" style="unicode-bidi:isolate">' + esc(s) + '</span>'; }
    var att = [name(ctx.opts.fileName) + ' · ' + ltr(mb(ctx.opts.bytes.byteLength))];
    if (ctx.opts.deck) att.push('מצגת משקיעים (מצורפת אוטומטית)');
    return dialog('<h3>לפני השליחה</h3>' +
      '<p class="mf-meta">אל: ' + ltr(ctx.rec.to.join(', ')) + (ctx.rec.cc.length ? '<br>עותק: ' + ltr(ctx.rec.cc.join(', ')) : '') + '<br>מאת: ' + ltr('MAOZ GROUP <info@maoz-group.com>') + ' &nbsp; <button type="button" class="mf-link" id="mfEdit">עריכת הנמענים</button></p>' +
      '<label class="mf-lbl">נושא</label><input class="mf-input" id="mfSubject" dir="rtl" value="' + esc(letter.subject) + '">' +
      '<label class="mf-lbl">קבצים מצורפים</label><p class="mf-att">' + att.join('<br>') + '</p>' +
      '<label class="mf-lbl">תוכן המייל</label><textarea class="mf-body" id="mfBody" dir="rtl" rows="16"></textarea>' +
      '<label class="mf-lbl">החתימה שתצורף בסוף המייל</label><div class="mf-sig"><img src="../mail/signature.png" alt="MAOZ GROUP"></div>' +
      '<p class="mf-err" id="mfErr"></p>' +
      '<div class="mf-btns"><button type="button" class="mf-btn mf-yes" id="mfSendGo">שליחה</button><button type="button" class="mf-btn mf-no" data-cancel>ביטול</button></div>',
      function (c, close) {
        c.querySelector('#mfBody').value = letter.text;   // value, never innerHTML: the page's translator must not touch the letter
        c.querySelector('#mfEdit').onclick = function () { close({ edit: true }); };
        c.querySelector('#mfSendGo').onclick = function () {
          var subject = c.querySelector('#mfSubject').value.trim(), text = c.querySelector('#mfBody').value;
          if (!subject) { c.querySelector('#mfErr').textContent = 'יש להזין נושא'; return; }
          if (!text.trim()) { c.querySelector('#mfErr').textContent = 'תוכן המייל ריק'; return; }
          close({ subject: subject, text: text });
        };
      }, true);
  }

  function ensureSetup() {
    if (avail && avail.configured) return Promise.resolve(true);
    return mailRelay('maoz-mail-setup', {}, 900000).then(function (d) { var ok = !!(d && d.ok && d.result && d.result.ok); if (ok && avail) avail.configured = true; return ok; });
  }
  function saveInstead(ctx) {
    return card('<h3>המייל לא נשלח</h3><p>לשמור את ' + esc(ctx.opts.label) + ' במחשב?</p>', [{ label: 'שמירה', value: 'save' }, { label: 'סגירה', value: null }])
      .then(function (v) { if (v === 'save') ctx.opts.saveAs(); });
  }
  function send(ctx, letter) {
    var T = window.MAOZ_MAIL_TEMPLATE;
    // the letter ends on "בברכה,"; the signature is the card (an inline image) in the HTML part and its text in the plain part
    var text = String(letter.text).replace(/\s+$/, '') + (T && T.SIGNATURE_TEXT ? String.fromCharCode(10) + T.SIGNATURE_TEXT : '');
    return mailRelay('maoz-mail-send', {
      to: ctx.rec.to, cc: ctx.rec.cc, subject: letter.subject, text: text,
      html: T ? T.textToHtml(letter.text, { signatureCid: T.SIGNATURE_CID }) : undefined,
      attachments: [{ name: ctx.opts.fileName, bytes: ctx.opts.bytes }], deck: ctx.opts.deck || false, signature: true
    }, 600000);
  }
  function doSend(ctx, letter) {
    veil('שולח את המייל… (' + mb(ctx.opts.bytes.byteLength + (ctx.opts.deck && DECK_MB[ctx.opts.deck] ? DECK_MB[ctx.opts.deck] : 0)) + ')');
    return send(ctx, letter).then(function (d) {
      veil(null);
      var r = d && d.ok ? d.result : null;
      if (r && r.ok) {
        return card('<h3>המייל נשלח בהצלחה</h3><p>נשלח אל ' + ltr(ctx.rec.to.join(', ')) + (ctx.rec.cc.length ? ' (ועותק ל-' + ltr(ctx.rec.cc.join(', ')) + ')' : '') + ' עם ' + esc(ctx.opts.label) + (ctx.opts.deck ? ' ומצגת המשקיעים' : '') + ' · ' + mb(r.bytes || ctx.opts.bytes.byteLength) + '.<br>עותק נשמר בתיקייה "נשלחו" של ' + ltr('info@maoz-group.com') + '.</p>',
          [{ label: 'סגירה', value: null }, { label: 'שמירת עותק של החוברת', value: 'save' }]).then(function (v) { if (v === 'save') ctx.opts.saveAs(); });
      }
      var msg = (r && r.error) || (d && d.error === 'timeout' ? 'השליחה נמשכת יותר מדי זמן. בדקו את החיבור ונסו שוב.' : (d && d.error === 'origin' ? 'המסמך הזה לא רשאי לשלוח דואר.' : 'השליחה נכשלה.'));
      if (r && (r.needsSetup || /גוגל דחה|חסם כניסה/.test(msg))) {
        if (avail) avail.configured = false;
        return card('<h3>השליחה נכשלה</h3><p>' + esc(msg) + '</p>', [{ label: 'הגדרת הדואר מחדש', value: 'setup' }, { label: 'ביטול', value: null }]).then(function (v) {
          if (v !== 'setup') return saveInstead(ctx);
          return ensureSetup().then(function (ok) { return ok ? doSend(ctx, letter) : saveInstead(ctx); });
        });
      }
      return card('<h3>השליחה נכשלה</h3><p>' + esc(msg) + '</p>', [{ label: 'ניסיון נוסף', value: 'retry' }, { label: 'ביטול', value: null }])
        .then(function (v) { return v === 'retry' ? doSend(ctx, letter) : saveInstead(ctx); });
    });
  }

  function run(opts) {
    var ctx = { opts: opts };
    return askSend(opts).then(function (v) {
      if (v !== 'yes') { opts.saveAs(); return; }
      return ensureSetup().then(function (ok) {
        if (!ok) return saveInstead(ctx);
        return askWho().then(function (who) {
          if (!who) return saveInstead(ctx);
          ctx.who = who;
          function recipients(prev) {
            return askRecipients(who, prev).then(function (rec) { if (!rec) return saveInstead(ctx); ctx.rec = rec; return preview(); });
          }
          function preview() {
            var letter = opts.compose({ names: ctx.rec.names, number: who.number, gender: who.gender });
            return askPreview(ctx, letter).then(function (p) {
              if (!p) return saveInstead(ctx);
              if (p.edit) return recipients(ctx.rec);
              return doSend(ctx, p);
            });
          }
          return recipients(null);
        });
      });
    }).then(null, function (err) { veil(null); try { console.error('mail flow failed', err); } catch (e) { /* no console */ } });
  }

  window.MaozMailFlow = { probe: probe, run: run };
})();
