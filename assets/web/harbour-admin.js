/* THE HARBOUR - the admin screen (his ask, 2026-10-28): he marks the units sold, reserved or available and edits their
   asking prices himself, and every company PC, the TV PC and the iPad/iPhone follow at once; and he sees which units are
   viewed, booked and e-mailed most. The server is a Firebase project in his Google account - a Realtime Database and an
   e-mail/password sign-in, no spreadsheet; tools/harbour-admin/DESIGN.md is the contract between it and this file, and
   the database's rules (tools/harbour-admin/firebase/database.rules.json) are the security: nothing here is secret.
   harbour.html loads this file last (scripts/edit-harbour-admin.mjs); the same file runs in the app and the web edition.
   - Offline first: the baked SOLD list in sold-gate-js is the floor, the last state from the database is cached on the
     device, and any network failure is simply "offline" - nothing here ever throws into the page.
   - The statistics are counts only: never a client's name or an e-mail address.
   - One IIFE, no dependencies; it brings its own CSS (style#mza-css). */
(function(){
  'use strict';
  // The Firebase project (DESIGN.md): the database, the public Web API key (public by design - the rules decide), and
  // the data under /{ENV}. Identity Toolkit and Secure Token are Google's sign-in and token-refresh services.
  var DB='https://maoz-harbour-admin-default-rtdb.europe-west1.firebasedatabase.app';
  var KEY='AIzaSyDyQ2Hb8s3Mo0wsWbuWCse7fWPGqUzOJ-o';
  var ENV='harbour';
  var IDT='https://identitytoolkit.googleapis.com', STS='https://securetoken.googleapis.com';
  // A test harness may point the page at the test data before this file runs - {env:'harbourtest'}, and optionally a
  // local fake of both services ({db, auth}: http://127.0.0.1 or localhost only; the auth fake is addressed the way the
  // Firebase emulator is, {auth}/identitytoolkit.googleapis.com/... and {auth}/securetoken.googleapis.com/...).
  // harbour.html itself never sets it, and nothing a test sets can reach the live data.
  try{
    var tx=window.MZ_HARBOUR_TEST, loc=/^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/;
    if(tx&&typeof tx==='object'&&tx.env==='harbourtest'){
      ENV='harbourtest';
      var tdb=typeof tx.db==='string'?tx.db.replace(/\/+$/,''):'', tau=typeof tx.auth==='string'?tx.auth.replace(/\/+$/,''):'';
      if(loc.test(tdb)) DB=tdb;
      if(loc.test(tau)){ IDT=tau+'/identitytoolkit.googleapis.com'; STS=tau+'/securetoken.googleapis.com'; }
    }
  }catch(e){}

  if(window.__mzAdmin) return;   // loaded twice: the first copy already owns the page
  window.__mzAdmin=true;

  var UNITS=['Y1','Y2','Y3','I1','I2','I3','I4','A1','A2','A3','A4','B1','B2','B3','B4','C1','C2','C3','C4'];
  var FLOORS=[{k:'Y',he:'קומת גן',en:'Garden floor'},{k:'I',he:'קומת קרקע',en:'Ground floor'},{k:'A',he:'קומה 1',en:'Floor 1'},{k:'B',he:'קומה 2',en:'Floor 2'},{k:'C',he:'קומה 3',en:'Floor 3'}];
  var STATUSES=['avail','reserved','sold'];
  var K_DEV='mz-harbour-dev', K_OUT='mz-harbour-outbox', K_STATE='mz-harbour-state', K_SEEN='mz-harbour-seen', K_AUTH='mz-harbour-auth', K_EMAIL='mz-harbour-email';
  var POLL_MS=90000, FLUSH_MS=45000, TIMEOUT_MS=25000, OUT_CAP=500, BODY_MAX=60000, VIEW_DEDUPE_MS=600000;
  // the stream of /state: tried again after a failure, later each time (30 s ... 5 min); the 90 s poll covers the gap.
  // STALL_MS: an open stream that has said nothing for that long - not even the database's keep-alive, every 30 s - is
  // as good as gone
  var STREAM_MIN=30000, STREAM_MAX=300000, STALL_MS=75000;
  // INC_MAX: the rules let one counter grow by at most 200 in one write; LOG_MAX: the log rows read (the newest);
  // DAY_RE: the rules' day key - a calendar-shaped date from 2026 (when the counters began) on
  var INC_MAX=200, LOG_MAX=500, DAY_RE=/^20(2[6-9]|[3-9][0-9])-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  var GV_MIN=250000, PRICE_MIN=10000, PRICE_MAX=5000000;
  // shared presentation devices: 10 minutes without his hand on the admin card (open or closed) and it asks him to sign
  // in again - checked every TICK_MS; the ID token (an hour) is renewed 5 minutes before it runs out
  var IDLE_MS=600000, TICK_MS=15000, REFRESH_EARLY=300000, LEASE_MS=30000, DEV_BARS=10, DEV_OPTIONS=50;
  var PLAT=location.protocol==='maoz-asset:'?'app':'pwa';
  var TS={'.sv':'timestamp'};   // the database's own clock, in a write
  var EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* ---------------------------------------------------------------- small helpers */
  function isEn(){ return document.documentElement.classList.contains('lang-en'); }
  function L(he,en){ return isEn()?en:he; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function ltr(s){ return '<span dir="ltr" class="mza-ltr">'+esc(s)+'</span>'; }
  function fmtInt(n){ n=Math.round(+n||0); return n.toLocaleString('en-US'); }
  function eur(n){ return '€'+fmtInt(n); }
  function digits(s){ return String(s==null?'':s).replace(/[^\d]/g,''); }
  function rand36(n){
    var s='', a=null;
    try{ a=new Uint8Array(n); window.crypto.getRandomValues(a); }catch(e){ a=null; }
    for(var i=0;i<n;i++) s+=((a?a[i]:Math.floor(Math.random()*256))%36).toString(36);
    return s;
  }
  function lsGet(k){ try{ var v=localStorage.getItem(k); return v==null?null:JSON.parse(v); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
  function ready(fn){ if(document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded',fn); }
  function stName(s){ return s==='sold'?L('נמכרה','Sold'):s==='reserved'?L('שמורה','Reserved'):L('זמינה','Available'); }
  function unitName(c){ var a=window.APTDATA&&window.APTDATA[c]; return String(a&&a.n||c).replace(new RegExp('\\s*'+c+'\\s*$'),''); }
  function priceOf(v){ var n=parseInt(digits(v),10); return isFinite(n)&&n>0?n:0; }
  function pad2(n){ return (n<10?'0':'')+n; }
  function fmtTime(ms){ var d=new Date(+ms); if(!+ms||isNaN(d.getTime())) return ''; return pad2(d.getDate())+'/'+pad2(d.getMonth()+1)+'/'+String(d.getFullYear()).slice(2)+' '+pad2(d.getHours())+':'+pad2(d.getMinutes()); }
  // this device's own calendar day (the statistics are kept by day): YYYY-MM-DD, and back to its local midnight
  function dayKey(ms){ var d=new Date(+ms); return isNaN(d.getTime())?'':d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
  function dayStart(k){ var m=/^(\d{4})-(\d\d)-(\d\d)$/.exec(k||''); return m?new Date(+m[1],+m[2]-1,+m[3]).getTime():0; }
  // a day key that is a real date (the rules let 2026-02-30 through: it has the shape)
  function realDay(k){ return DAY_RE.test(k)&&dayKey(dayStart(k))===k; }
  // the first day of a range of n days ending today, counted in calendar days - not in 24-hour steps: the day the clocks
  // change is 23 or 25 hours long
  function rangeFirst(n){ var t=new Date(); return dayKey(new Date(t.getFullYear(),t.getMonth(),t.getDate()-(n-1)).getTime()); }
  function obj(x){ return x&&typeof x==='object'&&!Array.isArray(x)?x:{}; }
  function own(o,k){ return Object.prototype.hasOwnProperty.call(o,k); }

  /* ---------------------------------------------------------------- the CSS */
  // the glass, navy and gold of the e-mail card (.mail-card) and the SOLD card; no transitions on painted or laid-out
  // properties and no hover that moves anything (scripts/style-guard.mjs); one blur only, on the overlay, none on the TV
  var CSS=[
    /* the lock: a flex item after the heading's second gold line; its negative margin cancels its width and the gap, so
       "מפרט דירות" stays exactly centred (and clear of the fixed back chip in the corner) */
    'h3.apt-spec-head .mza-lock{order:2;flex:none;position:relative;width:34px;height:34px;padding:0;margin:0;margin-inline-end:-49px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(216,180,106,.2);background:transparent;color:rgba(216,180,106,.42);cursor:pointer;font-size:0;line-height:0;text-shadow:none;box-shadow:none}',
    '.mza-lock svg{width:15px;height:15px;display:block;pointer-events:none}',
    'h3.apt-spec-head .mza-lock:hover,h3.apt-spec-head .mza-lock:focus-visible{color:#d8b46a;border-color:rgba(216,180,106,.6)}',
    'h3.apt-spec-head .mza-lock:focus-visible{outline:2px solid #d8b46a;outline-offset:2px}',
    /* reserved: the SOLD stamp's twin in amber (sold-style), a little smaller - RESERVED is twice as long */
    '.res-tag{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-14deg);background:rgba(245,241,232,.08);color:rgba(240,168,60,.8);border:2px solid rgba(240,168,60,.62);border-radius:8px;font-family:\'Heebo\',\'Assistant\',sans-serif;font-weight:800;font-size:clamp(14px,1.15vw,21px);letter-spacing:.2em;line-height:1;padding:7px 11px 7px 15px;white-space:nowrap;pointer-events:none;z-index:3}',
    '.apt-unit.apt-reserved{border-color:rgba(240,168,60,.6);box-shadow:0 18px 42px -22px rgba(0,0,0,.65),0 0 24px -2px rgba(240,160,50,.38)}',
    '.apt-unit.apt-reserved:hover{border-color:rgba(248,192,110,.9);box-shadow:0 20px 40px -20px rgba(0,0,0,.55),0 0 34px 0 rgba(240,165,60,.5)}',
    /* the e-mail flow's apartment chooser: a reserved unit is marked like a sold one, in amber */
    '.mail-apt-res{border-color:rgba(240,168,60,.55)}',
    '.mail-res{color:#f0b25a}',
    '.mail-apt.on .mail-res{color:#6b4210}',
    /* the overlay */
    '.mza-overlay{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(6,16,12,.78);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#e8eef2;font-family:\'Heebo\',\'Assistant\',sans-serif;font-size:14.5px;line-height:1.5}',
    '.mza-overlay.open{display:flex}',
    'html.big-screen .mza-overlay{-webkit-backdrop-filter:none;backdrop-filter:none;background:rgba(6,16,12,.9)}',
    'html.mza-open #langChip{display:none}',
    'html.mini-cursor-on .mza-overlay,html.mini-cursor-on .mza-overlay *{cursor:auto!important}',
    'html.mini-cursor-on .mza-overlay button:not(:disabled),html.mini-cursor-on .mza-overlay select,html.mini-cursor-on .mza-lock{cursor:pointer!important}',
    'html.mini-cursor-on .mza-overlay input{cursor:text!important}',
    '.mza-overlay *{box-sizing:border-box}',
    '.mza-card{position:relative;background:linear-gradient(165deg,rgba(17,38,60,.66),rgba(10,24,40,.76));border:1px solid rgba(216,180,106,.4);border-radius:20px;box-shadow:0 40px 80px -20px rgba(0,0,0,.7);text-align:start;color:#e8eef2}',
    'html.big-screen .mza-card{background:linear-gradient(165deg,rgba(17,38,60,.94),rgba(10,24,40,.97))}',
    '.mza-small{width:92vw;max-width:440px;max-height:92vh;overflow-y:auto;overscroll-behavior:contain;padding:26px 28px}',
    '.mza-card h3{font-family:\'Cormorant Garamond\',\'Frank Ruhl Libre\',serif;font-style:italic;font-weight:600;font-size:22px;line-height:1.25;color:#f0e9d8;margin:0 0 10px}',
    '.mza-card p{margin:0 0 12px;color:#cfd9e2}',
    '.mza-card h4{margin:18px 0 8px;font:600 14px/1.4 \'Heebo\',\'Assistant\',sans-serif;color:#e7d3a6}',
    '.mza-card h4:first-child{margin-top:4px}',
    '.mza-ltr{unicode-bidi:isolate}',
    '.mza-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:16px}',
    '.mza-btn{font:600 15px/1.2 \'Heebo\',\'Assistant\',sans-serif;padding:9px 26px;border-radius:12px;cursor:pointer}',
    '.mza-yes{background:#d8b46a;color:#0b1d2e;border:1px solid #d8b46a}',
    '.mza-no{background:rgba(255,255,255,.06);color:#e8eef2;border:1px solid rgba(216,180,106,.45)}',
    '.mza-btn:disabled{opacity:.5;cursor:default}',
    '.mza-sm{padding:6px 14px;font-size:13px;border-radius:10px}',
    '.mza-btn:focus-visible,.mza-tab:focus-visible,.mza-pill:focus-visible,.mza-chip:focus-visible,.mza-x:focus-visible,.mza-linkbtn:focus-visible{outline:2px solid #f0e9d8;outline-offset:2px}',
    '.mza-input,.mza-select{min-width:0;padding:8px 11px;border-radius:10px;border:1px solid rgba(216,180,106,.5);background:rgba(255,255,255,.07);color:#fff;font:15px/1.3 \'Heebo\',\'Assistant\',sans-serif;outline:none}',
    '.mza-input:focus,.mza-select:focus{border-color:#d8b46a;box-shadow:0 0 0 2px rgba(216,180,106,.25)}',
    '.mza-input:disabled{opacity:.55}',
    '.mza-input.mza-bad{border-color:#e07b7b}',
    '.mza-select option{background:#0b1d2e;color:#fff}',
    /* the sign-in fields: the card's width, and 16px (an iPhone zooms into a smaller field when it is focused) */
    '.mza-wide{display:block;width:100%;font-size:16px}',
    /* .mza-card .mza-err: above .mza-card p's grey */
    '.mza-card .mza-err{min-height:20px;color:#f08a8e;font-size:13.5px;margin:10px 0 0!important;text-align:center}',
    '.mza-card .mza-err.mza-info{color:#e7d3a6}',
    '.mza-note{font-size:13px;color:rgba(207,217,226,.78)!important}',
    '.mza-forgot{margin:12px 0 0!important;text-align:center}',
    /* the admin card */
    '.mza-admin{width:94vw;max-width:1080px;height:min(900px,92vh);display:flex;flex-direction:column;overflow:hidden;padding:0}',
    '.mza-head{display:flex;align-items:center;gap:12px;padding:18px 22px 10px}',
    '.mza-head h3{margin:0;flex:1 1 auto;min-width:0}',
    /* dir=ltr inside an RTL title: margin-inline-start would land on its far side, so the same gap on both */
    '.mza-sub{font-family:\'Space Grotesk\',\'Heebo\',sans-serif;font-style:normal;font-size:12px;letter-spacing:.14em;color:#e7d3a6;margin:0 8px;vertical-align:middle;white-space:nowrap}',
    '.mza-conn{flex:none;font-size:12.5px;padding:3px 10px;border-radius:12px;border:1px solid rgba(216,180,106,.35);color:#e7d3a6;white-space:nowrap}',
    '.mza-conn.off{border-color:rgba(240,110,115,.55);color:#f08a8e}',
    '.mza-x{flex:none;width:36px;height:36px;border-radius:50%;border:1px solid rgba(216,180,106,.45);background:rgba(255,255,255,.06);color:#e7d3a6;font-size:22px;line-height:1;padding:0;cursor:pointer}',
    /* 6px on top: overflow-x clips vertically too, and the focus ring reaches 4px above a tab */
    '.mza-tabs{display:flex;gap:8px;padding:6px 22px 12px;border-bottom:1px solid rgba(216,180,106,.18);overflow-x:auto;flex:none}',
    '.mza-tab,.mza-chip{font:600 14.5px/1.2 \'Heebo\',\'Assistant\',sans-serif;color:#e7d3a6;background:rgba(255,255,255,.06);border:1px solid rgba(216,180,106,.35);border-radius:30px;padding:8px 18px;white-space:nowrap;cursor:pointer}',
    '.mza-chip{font-size:13px;padding:6px 14px}',
    '.mza-tab[aria-selected="true"],.mza-chip.on{background:#d8b46a;color:#0b1d2e;border-color:#d8b46a}',
    '.mza-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:14px 22px 22px}',
    '.mza-foot{flex:none;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 22px;border-top:1px solid rgba(216,180,106,.18)}',
    '.mza-foot[hidden]{display:none}',
    '.mza-pend{flex:1 1 auto;font-size:13.5px;color:#e7d3a6}',
    '.mza-linkbtn{background:none;border:0;padding:0;margin:0;font:inherit;font-size:13.5px;color:#f08a8e;text-decoration:underline;text-align:start;cursor:pointer}',
    '.mza-linkbtn.mza-gold{color:#e7d3a6}',
    '.mza-linkbtn:disabled{opacity:.5;cursor:default}',
    '.mza-foot-btns{display:flex;gap:10px}',
    '.mza-foot-err{flex:1 1 100%;color:#f08a8e;font-size:13.5px}',
    '.mza-foot-err:empty{display:none}',
    /* centred by auto margins (a translateX(-50%) box can only grow to half the card); toast() lifts it above the footer */
    '.mza-toast{position:absolute;left:0;right:0;bottom:16px;margin:0 auto;width:max-content;max-width:calc(100% - 32px);background:#d8b46a;color:#0b1d2e;font-weight:600;font-size:14px;padding:8px 18px;border-radius:12px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:2;text-align:center}',
    '.mza-toast.on{opacity:1}',
    '.mza-toast.bad{background:#e0606a;color:#fff}',
    /* units */
    '.mza-units{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:10px}',
    '.mza-unit{border:1px solid rgba(216,180,106,.22);border-radius:14px;padding:10px 12px;background:rgba(255,255,255,.035)}',
    '.mza-unit.mza-dirty{border-color:#d8b46a;background:rgba(216,180,106,.1)}',
    '.mza-u-head{display:flex;align-items:baseline;gap:8px;margin-bottom:8px;min-width:0}',
    '.mza-u-head b{font-size:16px;color:#f0e9d8}',
    '.mza-u-name{font-size:12px;color:rgba(232,238,242,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.mza-gv{font-size:10.5px;letter-spacing:.08em;color:#d8b46a;border:1px solid rgba(216,180,106,.45);border-radius:8px;padding:0 6px;white-space:nowrap}',
    '.mza-pills{display:flex;gap:6px}',
    '.mza-pill{flex:1 1 0;min-width:0;font:600 13px/1.2 \'Heebo\',\'Assistant\',sans-serif;padding:7px 4px;border-radius:20px;border:1px solid rgba(216,180,106,.3);background:rgba(255,255,255,.05);color:#cfd9e2;cursor:pointer}',
    '.mza-pill.mza-p-avail.on{background:#d8b46a;border-color:#d8b46a;color:#0b1d2e}',
    '.mza-pill.mza-p-reserved.on{background:#f0a83c;border-color:#f0a83c;color:#2b1a04}',
    '.mza-pill.mza-p-sold.on{background:#e0606a;border-color:#e0606a;color:#fff}',
    '.mza-pill:disabled{opacity:.55;cursor:default}',
    '.mza-price{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:12.5px;color:#e7d3a6}',
    '.mza-in-wrap{flex:1 1 auto;display:flex;align-items:center;gap:6px;min-width:0}',
    '.mza-in-wrap .mza-input{flex:1 1 auto;width:100%;font-variant-numeric:tabular-nums;padding:6px 10px}',
    '.mza-line{margin:6px 0 0!important;font-size:12px;line-height:1.45}',
    '.mza-line:empty{display:none}',
    '.mza-bad-t{color:#f08a8e}',
    '.mza-warn-t{color:#f0b25a}',
    '.mza-was{color:rgba(207,217,226,.75)}',
    /* statistics */
    '.mza-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}',
    '.mza-seg{display:inline-flex;gap:6px;flex-wrap:wrap}',
    '.mza-filters label{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#e7d3a6}',
    '.mza-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px;margin:12px 0 4px}',
    '.mza-kpi{border:1px solid rgba(216,180,106,.25);border-radius:14px;padding:10px 12px;background:rgba(255,255,255,.04)}',
    '.mza-kpi b{display:block;font:700 24px/1.15 \'Heebo\',\'Assistant\',sans-serif;color:#f0e9d8;font-variant-numeric:tabular-nums}',
    '.mza-kpi span{display:block;font-size:12px;color:#e7d3a6}',
    '.mza-kpi small{display:block;font-size:11.5px;color:rgba(207,217,226,.7)}',
    '.mza-tablewrap{overflow-x:auto;overscroll-behavior-x:contain}',
    '.mza-table{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}',
    '.mza-table thead th{font-weight:600;font-size:12px;color:#e7d3a6;text-align:start;padding:7px 8px;border-bottom:1px solid rgba(216,180,106,.28);white-space:nowrap}',
    '.mza-table tbody th{font-weight:600;text-align:start;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.07);white-space:nowrap}',
    '.mza-table td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.07);vertical-align:middle}',
    '.mza-table .n{text-align:center}',
    '.mza-table tr.mza-undone td.mza-chg{text-decoration:line-through;opacity:.6}',
    '.mza-st{display:inline-block;padding:1px 9px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap}',
    '.mza-st-avail{color:#d8b46a;border:1px solid rgba(216,180,106,.5)}',
    '.mza-st-reserved{color:#f0a83c;border:1px solid rgba(240,168,60,.55)}',
    '.mza-st-sold{color:#f08a8e;border:1px solid rgba(240,110,115,.55)}',
    '.mza-fun{display:flex;flex-direction:column;gap:2px;width:120px}',
    '.mza-fun i{display:block;height:4px;border-radius:2px;min-width:2px}',
    /* four hues that stay apart (the legend is the only key on a touch screen) */
    '.mza-fun i.f0{background:#d8b46a}.mza-fun i.f1{background:#9fc0d6}.mza-fun i.f2{background:#6fc2b0}.mza-fun i.f3{background:#f0a83c}',
    '.mza-fun i.z{background:rgba(255,255,255,.12);width:2px!important}',
    '.mza-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:rgba(207,217,226,.8);margin:6px 0 0}',
    '.mza-legend i{display:inline-block;width:12px;height:4px;border-radius:2px;vertical-align:middle;margin-inline-end:5px}',
    '.mza-grid3{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}',
    '.mza-box{border:1px solid rgba(216,180,106,.22);border-radius:14px;padding:10px 14px;background:rgba(255,255,255,.03)}',
    '.mza-box h5{margin:0 0 6px;font:600 13px/1.4 \'Heebo\',\'Assistant\',sans-serif;color:#e7d3a6}',
    '.mza-box ol{margin:0;padding:0;list-style:none;font-variant-numeric:tabular-nums}',
    '.mza-box li{margin:4px 0;display:flex;align-items:baseline;gap:7px;min-width:0}',
    '.mza-rank{flex:none;width:18px;height:18px;border-radius:50%;border:1px solid rgba(216,180,106,.5);color:#e7d3a6;font-size:11px;line-height:16px;text-align:center}',
    '.mza-box li bdi{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(232,238,242,.75);font-size:12.5px}',
    '.mza-cnt{margin-inline-start:auto;font-weight:600}',
    '.mza-bar{display:grid;grid-template-columns:minmax(64px,42%) 1fr 40px;align-items:center;gap:8px;font-size:12.5px;margin:5px 0}',
    '.mza-bar-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:start}',
    /* a device's name on its own row, the whole box wide (dir=auto: the ellipsis falls at the end of each name) */
    '.mza-bar2{grid-template-columns:1fr 40px;row-gap:3px;margin:7px 0}',
    '.mza-bar2 .mza-bar-l{grid-column:1/-1}',
    '.mza-more{margin:6px 0 0!important;font-size:12px}',
    /* "close without saving?" over the admin card */
    '.mza-confirm{position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;padding:16px;border-radius:20px;background:rgba(6,16,12,.74)}',
    '.mza-confirm .mza-card{width:100%;max-width:440px}',
    '.mza-bar-t{height:8px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}',
    '.mza-bar-t i{display:block;height:100%;border-radius:4px;background:#d8b46a}',
    '.mza-bar b{font-weight:600;text-align:end;font-variant-numeric:tabular-nums}',
    /* settings */
    '.mza-set{border:1px solid rgba(216,180,106,.22);border-radius:14px;padding:12px 16px;margin:0 0 12px;background:rgba(255,255,255,.03)}',
    '.mza-set h4{margin:0 0 8px}',
    '.mza-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
    '.mza-row .mza-input{flex:1 1 200px}',
    '.mza-lbl{display:block;font-size:12.5px;color:#e7d3a6;margin:8px 0 4px}',
    '.mza-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px;margin:4px 0 10px}',
    '.mza-kv dt{color:#e7d3a6}',
    '.mza-kv dd{margin:0;color:#cfd9e2;word-break:break-word}',
    /* touch: targets of about 44px */
    '@media (pointer: coarse){',
    '  h3.apt-spec-head .mza-lock{width:44px;height:44px;margin-inline-end:-59px}',
    '  .mza-lock svg{width:18px;height:18px}',
    '  .mza-btn,.mza-tab,.mza-chip,.mza-pill,.mza-input,.mza-select,.mza-x{min-height:44px}',
    '  .mza-x{width:44px}',
    '  .mza-forgot .mza-linkbtn{min-height:44px;padding:0 8px}',
    '}',
    /* a phone, and the narrow PWA window */
    '@media (max-width: 820px){',
    '  .mza-small{width:94vw;max-width:94vw;padding:20px 16px}',
    '  .mza-admin{width:94vw;max-width:94vw}',
    '  .mza-head,.mza-tabs,.mza-scroll,.mza-foot{padding-left:14px;padding-right:14px}',
    '  .mza-units{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}',
    '  .mza-btn{padding:9px 18px}',
    '}',
    /* the per-unit table on a narrow screen: no funnel column (the numbers are in the row), headers may wrap */
    '@media (max-width: 600px){',
    '  .mza-table .mza-fun-col,.mza-legend.mza-fun-col{display:none}',
    '  .mza-table thead th{white-space:normal}',
    '  .mza-table thead th,.mza-table tbody th,.mza-table td{padding:6px 5px}',
    '}',
    /* a phone upright: all four tabs fit in the row */
    '@media (max-width: 420px){',
    '  .mza-tabs{flex-wrap:wrap;gap:6px}',
    '  .mza-tab{padding:8px 12px;font-size:13.5px}',
    '}',
    /* a phone held sideways: every pixel of height for the list - the tabs share the row with the status and the close
       button (the title goes), the note goes, the targets are 40px */
    '@media (pointer: coarse) and (max-height: 520px){',
    '  .mza-overlay{padding:6px}',
    '  .mza-admin{height:calc(100vh - 12px);max-height:none;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr) auto}',
    '  .mza-head{grid-column:2;grid-row:1;padding-block:6px;padding-inline:10px 14px;border-bottom:1px solid rgba(216,180,106,.18)}',
    '  .mza-head h3{display:none}',
    '  .mza-tabs{grid-column:1;grid-row:1;padding-block:6px;padding-inline:14px 10px;flex-wrap:nowrap}',
    '  .mza-scroll{grid-column:1/-1;grid-row:2;padding-top:8px;padding-bottom:12px}',
    '  .mza-foot{grid-column:1/-1;grid-row:3;padding-top:6px;padding-bottom:6px}',
    '  .mza-scroll .mza-note{display:none}',
    '  .mza-btn,.mza-tab,.mza-chip,.mza-pill,.mza-input,.mza-select{min-height:40px}',
    '  .mza-x{width:40px;height:40px;min-height:40px}',
    '  .mza-small{max-height:calc(100vh - 12px);padding:14px 18px}',
    '}'
  ].join('\n');
  // at the END of the body, after the document's own styles: the e-mail flow's CSS (.mail-sold, .mail-apt) sits in the
  // body, and an equal selector here must win
  function injectCss(){
    if(document.getElementById('mza-css')) return;
    var st=document.createElement('style'); st.id='mza-css'; st.textContent=CSS;
    (document.body||document.head||document.documentElement).appendChild(st);
  }

  /* ---------------------------------------------------------------- this device */
  var devId=(function(){
    var id=null;
    try{ id=localStorage.getItem(K_DEV); }catch(e){}
    if(!id||!/^d-[a-z0-9]{12}$/.test(id)){ id='d-'+rand36(12); try{ localStorage.setItem(K_DEV,id); }catch(e){} }
    return id;
  })();
  var device={host:'',ver:'',ready:false};
  var deviceWaiters=[];
  function uaLabel(){
    var ua=navigator.userAgent||'';
    if(/iPad/.test(ua)||(/Macintosh/.test(ua)&&(navigator.maxTouchPoints||0)>1)) return 'iPad';
    if(/iPhone|iPod/.test(ua)) return 'iPhone';
    if(/Android/.test(ua)) return 'Android';
    return 'Browser';
  }
  // the bounds the rules hold the device record to: host up to 64 characters, the version up to 20
  function deviceDone(host,ver){
    if(device.ready) return;
    device.host=String(host||'').slice(0,60)||uaLabel(); device.ver=String(ver||'').slice(0,20); device.ready=true;
    deviceWaiters.splice(0).forEach(function(f){ try{ f(); }catch(e){} });
  }
  function whenDevice(f){ if(device.ready) f(); else deviceWaiters.push(f); }
  // In the app the shell names this PC (maoz-device -> {host, version}: project-frame.ts relays to main). No ack within
  // 500 ms - the web edition, or an older shell - and the device is named from its user agent instead.
  function askDevice(){
    if(!(window.parent&&window.parent!==window)){ deviceDone(uaLabel(),''); return; }
    var reqId='maoz-device-'+rand36(8)+Date.now(), acked=false, t2=0;
    var t1=setTimeout(function(){ if(!acked){ window.removeEventListener('message',onMsg); deviceDone(uaLabel(),''); } },500);
    function onMsg(ev){
      var d=ev&&ev.data;
      if(!d||d.reqId!==reqId||ev.source!==window.parent) return;
      if(d.type==='maoz-device-ack'){
        acked=true; clearTimeout(t1);
        t2=setTimeout(function(){ window.removeEventListener('message',onMsg); deviceDone(uaLabel(),''); },8000);
      } else if(d.type==='maoz-device-result'){
        clearTimeout(t1); clearTimeout(t2); window.removeEventListener('message',onMsg);
        var r=d.ok&&d.result;
        deviceDone(r&&r.host?r.host:uaLabel(),r&&r.version||'');
      }
    }
    window.addEventListener('message',onMsg);
    try{ window.parent.postMessage({type:'maoz-device',reqId:reqId},'*'); }
    catch(e){ clearTimeout(t1); window.removeEventListener('message',onMsg); deviceDone(uaLabel(),''); }
  }

  /* ---------------------------------------------------------------- the network */
  // Every answer is {ok:true,status,data} or {ok:false,error,...}: 'offline' = the request did not get through (no
  // network, timeout, blocked); 'http' = the server said no - its status, and code = the service's own word for why (the
  // database's "Permission denied", Identity Toolkit's INVALID_LOGIN_CREDENTIALS...). Never rejects.
  var net={state:'',lastOk:0};
  function errCode(j){
    var e=j&&j.error;
    if(typeof e==='string') return e;
    if(e&&typeof e.message==='string') return e.message.split(/[\s:]/)[0];   // "TOO_MANY_ATTEMPTS_TRY_LATER : Access to..."
    return '';
  }
  function request(url,init){
    if(navigator.onLine===false){ net.state='off'; return Promise.resolve({ok:false,error:'offline'}); }
    return new Promise(function(resolve){
      var done=false, ctl=null, timer=0;
      function finish(r){ if(done) return; done=true; clearTimeout(timer); if(r.error==='offline') net.state='off'; else { net.state='on'; net.lastOk=Date.now(); } resolve(r); }
      init.credentials='omit'; init.cache='no-store';
      try{ ctl=typeof AbortController==='function'?new AbortController():null; }catch(e){ ctl=null; }
      if(ctl) init.signal=ctl.signal;
      timer=setTimeout(function(){ try{ if(ctl) ctl.abort(); }catch(e){} finish({ok:false,error:'offline',timeout:true}); },TIMEOUT_MS);
      var p;
      try{ p=fetch(url,init); }catch(e){ finish({ok:false,error:'offline'}); return; }
      p.then(function(res){
        return res.text().then(function(t){
          var j; try{ j=t?JSON.parse(t):null; }catch(e){ j=undefined; }
          if(!res.ok) return {ok:false,error:'http',status:res.status,code:errCode(j)};
          return j===undefined?{ok:false,error:'http',status:res.status,code:'not_json'}:{ok:true,status:res.status,data:j};
        });
      }).then(finish,function(){ finish({ok:false,error:'offline'}); });
    });
  }
  function qs(o){ return Object.keys(o).filter(function(k){ return o[k]!=null; }).map(function(k){ return k+'='+encodeURIComponent(o[k]); }).join('&'); }
  function dbUrl(path,q){ var s=qs(q||{}); return DB+'/'+ENV+(path?'/'+path:'')+'.json'+(s?'?'+s:''); }
  // a read; q: auth (an admin's reads), orderBy/startAt/limitToLast (the key queries)
  function dbGet(path,q){ return request(dbUrl(path,q),{method:'GET'}); }
  // A write: ONE multi-path update at /{env} - every path in it passes the rules, or nothing is written. POSTed as text
  // with the method in the query: a CORS simple request (no preflight), and the only kind a page that is going away
  // (keepalive) may still send. idToken: an admin's write; none: the anonymous counters.
  function dbPatch(body,idToken,keepalive){
    var init={method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(body)};
    if(keepalive) init.keepalive=true;
    return request(dbUrl('',{auth:idToken||null,'x-http-method-override':'PATCH'}),init);
  }
  // the sign-in service (JSON: a preflight, which Google answers) and the token refresh (a form: a simple request)
  function idt(method,body,locale){
    var h={'Content-Type':'application/json'};
    if(locale) h['X-Firebase-Locale']=locale;
    return request(IDT+'/v1/accounts:'+method+'?key='+KEY,{method:'POST',headers:h,body:JSON.stringify(body)});
  }
  function sts(refreshToken){
    return request(STS+'/v1/token?key='+KEY,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=refresh_token&refresh_token='+encodeURIComponent(refreshToken)});
  }

  /* ---------------------------------------------------------------- the shared state on this page */
  // baked = what harbour.html says (the SOLD list, APTDATA's prices) - the offline floor. The prices are read now, before
  // anything here writes to APTDATA; the statuses from window.MZ_BAKED_SOLD (sold-gate-js), else from the page itself.
  var baked={};
  (function(){
    var A=window.APTDATA||{}, sold=Array.isArray(window.MZ_BAKED_SOLD)?window.MZ_BAKED_SOLD:null;
    UNITS.forEach(function(c){ baked[c]={s:sold&&sold.indexOf(c)>=0?'sold':'avail',p:priceOf(A[c]&&A[c].p)}; });
    baked.__fromDom=!sold;
  })();
  function bakedFromPage(){
    if(!baked.__fromDom) return;
    delete baked.__fromDom;
    UNITS.forEach(function(c){ var b=document.querySelector('.apt-unit[data-apt="'+c+'"]'); if(b&&b.classList.contains('apt-sold')) baked[c].s='sold'; });
  }
  var cur=null;   // {rev, at, units, src:'cache'|'server'} - the newest state this page has applied
  function copyUnits(u){ var o={}; UNITS.forEach(function(c){ var x=u&&u[c]||baked[c]; o[c]={s:x.s,p:x.p}; }); return o; }
  function baseUnits(){ return cur?cur.units:copyUnits(baked); }
  // a server or cached state, field by field: anything missing or malformed keeps the baked value
  function cleanUnits(u){
    if(!u||typeof u!=='object') return null;
    var o={};
    UNITS.forEach(function(c){
      var x=u[c]||{}, b=baked[c], p=Math.round(+x.p);
      o[c]={s:STATUSES.indexOf(x.s)>=0?x.s:b.s,p:(isFinite(p)&&p>=PRICE_MIN&&p<=PRICE_MAX)?p:b.p};
    });
    return o;
  }
  function unitBtn(c){ return document.querySelector('.apt-unit[data-apt="'+c+'"]'); }
  // Reversible: whatever the button shows now (the baked SOLD, an earlier state), it ends showing s. A sold unit opens
  // the sold gate, a reserved one the reserved gate, an available one the apartment - as the baked buttons do.
  function applyStatus(c,s){
    var btn=unitBtn(c); if(!btn) return;
    var now=btn.classList.contains('apt-sold')?'sold':btn.classList.contains('apt-reserved')?'reserved':'avail';
    var tags=btn.querySelectorAll('.sold-tag,.res-tag');
    var tagOk=s==='avail'?tags.length===0:(tags.length===1&&tags[0].className===(s==='sold'?'sold-tag':'res-tag'));
    if(now===s&&tagOk) return;
    btn.classList.remove('apt-sold','apt-reserved');
    Array.prototype.forEach.call(tags,function(t){ t.parentNode.removeChild(t); });
    if(s==='sold'||s==='reserved'){
      btn.classList.add(s==='sold'?'apt-sold':'apt-reserved');
      var tag=document.createElement('span');
      tag.className=s==='sold'?'sold-tag':'res-tag'; tag.textContent=s==='sold'?'SOLD':'RESERVED';
      btn.appendChild(tag);
      btn.setAttribute('onclick',(s==='sold'?'soldGate':'mzReservedGate')+"('"+c+"')");
    } else {
      btn.setAttribute('onclick',"selectApt('"+c+"')");
    }
  }
  // The price in place: APTDATA (the calculator, the booklets and the e-mail chooser read it from there) and the
  // button. A calculator already open is left whole - its strip (#aptPrice) too, which its booklet prints beside the
  // price it computes with; selectApt rewrites both from APTDATA the next time the unit is opened.
  function applyPrice(c,p){
    if(!(p>0)) return;
    var txt=eur(p), a=window.APTDATA&&window.APTDATA[c];
    if(a&&a.p!==txt) a.p=txt;
    var btn=unitBtn(c), el=btn&&btn.querySelector('.au-price');
    if(el&&el.textContent!==txt) el.textContent=txt;
  }
  function applyUnits(u){ UNITS.forEach(function(c){ var x=u[c]; if(!x) return; try{ applyStatus(c,x.s); applyPrice(c,x.p); }catch(e){} }); }
  var lastFetch=0;
  // The database's rev only grows: within this session a read older than the state on screen (a GET that was read just
  // before a save, and arrived after it) is ignored. The stream is in order, so what it says always stands (ordered);
  // a cached state gives way to any fresh one.
  function sameUnits(a,b){ return UNITS.every(function(c){ return a[c].s===b[c].s&&a[c].p===b[c].p; }); }
  function setState(r,src,ordered){
    var units=cleanUnits(r&&r.units); if(!units) return false;
    var rev=+r.rev||0;
    if(src==='server'&&!ordered&&cur&&cur.src==='server'&&rev<cur.rev) return false;
    // the same state again (a GET after the stream, the stream confirming a save): nothing to apply or redraw - an open
    // panel is not rebuilt under the pointer for nothing; only the connection chip may have changed
    if(src==='server'&&cur&&cur.src==='server'&&rev===cur.rev&&sameUnits(units,cur.units)){
      if(r.at) cur.at=String(r.at);
      if(view==='admin') refreshConn();
      return true;
    }
    cur={rev:rev,at:String(r.at||(cur&&cur.at)||''),units:units,src:src};
    if(src==='server') lsSet(K_STATE,{rev:cur.rev,at:cur.at,units:units,saved:Date.now()});
    if(!adm.saving) applyUnits(units);   // a save in flight shows its own values until it is answered
    prunePending();
    if(view==='admin') softRefresh();
    return true;
  }
  // The database has no state (taken away by hand, or never seeded): the page keeps what it shows, but that is no longer
  // the database's - so the next write reads first and sends the whole state (rev 1), and whatever state comes is taken.
  function noState(){ if(cur&&cur.src==='server') cur.src='cache'; }
  // /state is public to read (no sign-in): every device follows it
  function fetchState(){
    lastFetch=Date.now();
    return dbGet('state').then(function(r){
      if(r.ok&&r.data&&typeof r.data==='object') setState(r.data,'server');
      else { if(r.ok&&r.data===null) noState(); if(view==='admin') refreshConn(); }
      return r;
    });
  }
  // a write needs the database's own state under it (its rev): when this page has only its cache, it reads it first.
  // {ok:true} (cur is the server's), {ok:true,none:true} (the database has no state yet), or the failed read.
  function serverState(){
    if(cur&&cur.src==='server') return Promise.resolve({ok:true});
    return fetchState().then(function(r){ return !r.ok?r:{ok:true,none:!(cur&&cur.src==='server')}; });
  }

  /* -- the live stream of /state */
  // An EventSource on state.json: 'put' (path '/' = the whole state, or one place in it) and 'patch' (several places at
  // once - a save is one multi-path update) are applied to a mirror of /state, and the mirror to the page. On 'cancel'
  // or an error it is closed and the 90 s GET takes over, while the stream is tried again later each time. Off screen
  // (the shell's 'harbour-hidden', or a hidden document) it is closed: a TV PC left on the main menu all day keeps no
  // connection open for nothing.
  // heard: when the open stream last said anything (an event or the keep-alive) - see watchStream
  var stream={es:null,raw:null,live:false,timer:0,delay:STREAM_MIN,heard:0};
  var onScreen=true;
  function streamWanted(){ return onScreen&&document.visibilityState!=='hidden'&&navigator.onLine!==false; }
  // a stream event's value at its path, into the mirror (null deletes, as the database does); never onto a prototype
  function putAt(root,path,val){
    var keys=String(path||'').split('/').filter(Boolean);
    if(keys.some(function(k){ return k==='__proto__'||k==='constructor'||k==='prototype'; })) return root;
    if(!keys.length) return val==null?null:val;
    if(!root||typeof root!=='object') root={};
    var o=root;
    for(var i=0;i<keys.length-1;i++){ if(!o[keys[i]]||typeof o[keys[i]]!=='object') o[keys[i]]={}; o=o[keys[i]]; }
    if(val==null) delete o[keys[keys.length-1]]; else o[keys[keys.length-1]]=val;
    return root;
  }
  function onStreamData(m,isPatch){
    var d=JSON.parse(m.data);
    if(!d||typeof d!=='object'||typeof d.path!=='string') return;
    if(isPatch){ var x=obj(d.data); Object.keys(x).forEach(function(k){ stream.raw=putAt(stream.raw,d.path+'/'+k,x[k]); }); }
    else stream.raw=putAt(stream.raw,d.path,d.data);
    stream.live=true; stream.delay=STREAM_MIN; net.state='on'; net.lastOk=stream.heard=Date.now();
    if(stream.raw&&typeof stream.raw==='object'&&stream.raw.units) setState(stream.raw,'server',true);
    else { if(stream.raw==null) noState(); if(view==='admin') refreshConn(); }
  }
  function closeStream(){
    var es=stream.es; stream.es=null; stream.live=false;
    if(es){ try{ es.close(); }catch(e){} }
  }
  function openStream(){
    clearTimeout(stream.timer); stream.timer=0;
    if(stream.es||!streamWanted()||typeof window.EventSource!=='function') return;
    var es;
    try{ es=new window.EventSource(dbUrl('state')); }catch(e){ streamFailed(); return; }
    stream.es=es; stream.raw=null; stream.heard=Date.now();
    // a late event of a stream already closed is not this page's business any more
    function on(fn){ return function(m){ if(stream.es!==es) return; try{ fn(m); }catch(e){} }; }
    es.addEventListener('put',on(function(m){ onStreamData(m,false); }));
    es.addEventListener('patch',on(function(m){ onStreamData(m,true); }));
    es.addEventListener('keep-alive',on(function(){ net.lastOk=stream.heard=Date.now(); }));
    es.addEventListener('cancel',on(streamFailed));
    es.addEventListener('auth_revoked',on(streamFailed));
    es.onerror=on(streamFailed);
  }
  function streamFailed(){
    closeStream();
    if(view==='admin') refreshConn();
    clearTimeout(stream.timer);
    if(streamWanted()){
      stream.timer=setTimeout(function(){ stream.timer=0; openStream(); },stream.delay);
      stream.delay=Math.min(STREAM_MAX,stream.delay*2);
      if(Date.now()-lastFetch>15000) fetchState();   // what the stream would have said, once now
    }
  }
  // A stream can stay open and pass nothing on - a proxy or an HTTPS-scanning antivirus on a company PC holding the
  // connection after its own upstream died - and then the page would trust it (and skip the 90 s GET) forever, a TV left
  // on the floors page showing an old status as live. The database sends a keep-alive every 30 s: STALL_MS without even
  // that and the stream counts as failed (closed, one GET, opened again later).
  function watchStream(){ if(stream.es&&Date.now()-stream.heard>STALL_MS) streamFailed(); }
  // The shell keeps this document loaded after he leaves the Harbour, in a hidden iframe whose visibilityState stays
  // 'visible': project-frame.ts says 'harbour-hidden' on the way out (and at a hidden preload) and 'harbour-view' on the
  // way back in (and on every section switch, which changes nothing here).
  function goHidden(){ closeStream(); clearTimeout(stream.timer); stream.timer=0; }
  function goVisible(){
    if(!streamWanted()) return;
    stream.delay=STREAM_MIN; openStream();
    if(Date.now()-lastFetch>5000) fetchState();
  }
  window.addEventListener('message',function(ev){
    var d=ev&&ev.data;
    if(!d||window.parent===window||ev.source!==window.parent) return;
    if(d.type==='harbour-hidden'){ onScreen=false; goHidden(); }
    else if(d.type==='harbour-view'){ var was=onScreen; onScreen=true; if(!was){ idleLock(); goVisible(); } }
  });
  // the stream's stand-in: a GET every 90 s while it is down (or the browser has no EventSource)
  function poll(){ if(streamWanted()&&!stream.live) fetchState(); }

  /* ---------------------------------------------------------------- tracking: counts only */
  // window.mzTrack(kind, data): queued in localStorage, sent as counters. Only counts go out - per day, device, unit and
  // kind (DESIGN.md); the queue keeps no more than a unit code, the language, the booklet's scenario and financing, the
  // gate's answer and a recipients COUNT. Nothing personal.
  var KINDS={view:1,plan:1,gate:1,export:1,mail:1,print:1};
  var memBox=[];
  function readBox(){ try{ var s=localStorage.getItem(K_OUT); if(s==null) return memBox.slice(); var a=JSON.parse(s); return Array.isArray(a)?a:[]; }catch(e){ return memBox.slice(); } }
  function writeBox(a){ memBox=a.slice(); try{ localStorage.setItem(K_OUT,JSON.stringify(a)); }catch(e){} }
  function dropIds(ids){ if(!ids||!ids.length) return; var set={}; ids.forEach(function(i){ set[i]=1; }); writeBox(readBox().filter(function(e){ return !set[e.i]; })); }
  function num(v){ var n=+v; return (v!==''&&v!=null&&isFinite(n))?n:null; }
  window.mzTrack=function(k,data){
    try{
      if(!KINDS[k]) return;
      var d=data||{}, e={t:Date.now(),k:k,u:UNITS.indexOf(d.u)>=0?d.u:'',l:(d.l==='en'||d.l==='he')?d.l:(isEn()?'en':'he')};
      if(d.scen==='cons'||d.scen==='real'||d.scen==='opt') e.scen=d.scen;
      var f=num(d.fin); if(f!=null) e.fin=Math.max(0,Math.min(100,Math.round(f)));
      if(d.role==='main'||d.role==='extra') e.role=d.role;
      if(d.res==='yes'||d.res==='no') e.res=d.res;
      if(d.st==='sold'||d.st==='reserved') e.st=d.st;
      var n=num(d.n); if(n!=null) e.n=Math.max(0,Math.min(999,Math.round(n)));
      e.i=rand36(10);   // this device's own id for the entry, so a sent batch can be taken off the queue; never sent
      var box=readBox(); box.push(e);
      if(box.length>OUT_CAP) box=box.slice(box.length-OUT_CAP);
      writeBox(box);
    }catch(err){}
  };
  // An entry -> the counters it adds to, {kind: n}. A booklet (exported or e-mailed) adds its segments too: scenario
  // ('current' already reads as the scenario it shows), language, financing band. The recipients count once per e-mail
  // - on its main booklet, not again on each extra one.
  function finKind(f){ f=+f||0; return f<=0?'fn_0':f<=30?'fn_30':f<=50?'fn_50':'fn_51'; }
  function kindsOf(e){
    var o={};
    function add(k,n){ o[k]=(o[k]||0)+n; }
    if(e.k==='view') add('v',1);
    else if(e.k==='plan') add('pl',1);
    else if(e.k==='print') add('pr',1);
    else if(e.k==='gate'){ add('gs',1); if(e.res==='yes') add('gy',1); }
    else if(e.k==='export'||e.k==='mail'){
      if(e.k==='export') add('ex',1);
      else { add('ml',1); if(e.role!=='extra'&&+e.n>0) add('mr',Math.min(INC_MAX,Math.round(+e.n))); }
      if(e.scen==='cons'||e.scen==='real'||e.scen==='opt') add('sc_'+e.scen,1);
      add(e.l==='en'?'ln_en':'ln_he',1);
      if(e.fin!=null) add(finKind(e.fin),1);
    }
    return o;
  }
  // local bookkeeping on an entry, never sent: i = its id, o/c = the page that took it and when (see takeBatch)
  var sending=null;   // the local ids of the batch on its way ([] while waiting for the outbox lock)
  var pageId=rand36(8);
  // The outbox is shared by every page of this origin (two tabs of the web edition): a page marks the entries it sends
  // with its id and the time, and another page leaves them alone for LEASE_MS - after that they are anyone's again (a
  // page that died with them on their way). Where the browser has Web Locks, taking a batch is also one page at a time.
  function claimedByOther(e,now){ return !!e.o&&e.o!==pageId&&now-(+e.c||0)<LEASE_MS; }
  // The next batch, summed into counters: paths = {stats/day/dev/unit/kind: n}. No counter grows by more than INC_MAX
  // in one write (the rules' bound) and the body stays under BODY_MAX: the entry that would pass either waits for the
  // next batch. junk = entries no counter can take (no unit, a clock outside the rules' years) - dropped.
  function takeBatch(now,mark){
    var box=readBox(), paths={}, ids=[], junk=[], set={}, size=400;
    for(var i=0;i<box.length;i++){
      var e=box[i]; if(!e||!e.i||claimedByOther(e,now)||(sending&&sending.indexOf(e.i)>=0)) continue;
      var day=dayKey(e.t), ks=UNITS.indexOf(e.u)>=0&&DAY_RE.test(day)?kindsOf(e):null, names=ks?Object.keys(ks):[];
      if(!names.length){ junk.push(e.i); continue; }
      var pre='stats/'+day+'/'+devId+'/'+e.u+'/', grow=0, over=false;
      names.forEach(function(k){ var p=pre+k; if((paths[p]||0)+ks[k]>INC_MAX) over=true; if(paths[p]==null) grow+=p.length+36; });
      if(over||size+grow>BODY_MAX) break;
      names.forEach(function(k){ paths[pre+k]=(paths[pre+k]||0)+ks[k]; });
      size+=grow; ids.push(e.i); set[e.i]=1;
    }
    if(mark&&ids.length){ box.forEach(function(e){ if(e&&set[e.i]){ e.o=pageId; e.c=now; } }); writeBox(box); }
    return {paths:paths,ids:ids,junk:junk};
  }
  function unclaim(ids){
    var set={}, box=readBox(), ch=false; ids.forEach(function(i){ set[i]=1; });
    box.forEach(function(e){ if(e&&set[e.i]&&e.o===pageId){ delete e.o; delete e.c; ch=true; } });
    if(ch) writeBox(box);
  }
  function boxLock(fn){
    try{ if(navigator.locks&&typeof navigator.locks.request==='function'){ navigator.locks.request('mz-harbour-outbox',function(){ fn(); }).catch(function(){}); return; } }catch(e){}
    fn();
  }
  // the one anonymous write: the counters as server-side increments, and this device's record (its name, platform,
  // version, and when it was last heard from - by the database's clock)
  function statsBody(paths){
    var b={}, d='devices/'+devId+'/';
    Object.keys(paths).forEach(function(p){ b[p]={'.sv':{increment:paths[p]}}; });
    b[d+'host']=String(device.host||uaLabel()).slice(0,64); b[d+'plat']=PLAT; b[d+'ver']=String(device.ver||'').slice(0,20); b[d+'last']=TS;
    return b;
  }
  // mode: undefined (the timer), 'hidden' (keepalive, and the answer still counts) or 'unload' (keepalive, and the batch
  // counts as sent - the page is going away and will not hear back; a lost batch is better than counting it twice)
  function flush(mode){
    if(mode==='unload'){
      if(sending){ dropIds(sending); sending=null; }
      var u=takeBatch(Date.now(),false);
      dropIds(u.ids.concat(u.junk));
      if(u.ids.length) dbPatch(statsBody(u.paths),null,true);
      return;
    }
    if(sending) return;
    if(!mode&&!device.ready) return;
    sending=[];
    boxLock(function(){
      if(!sending||sending.length) return;   // the page left meanwhile
      var t=takeBatch(Date.now(),true), ids=t.ids;
      if(t.junk.length) dropIds(t.junk);
      if(!ids.length){ sending=null; return; }
      sending=ids;
      dbPatch(statsBody(t.paths),null,!!mode).then(function(r){
        if(sending!==ids) return;   // the page was leaving: already taken off the queue
        sending=null;
        // a batch the database refuses (malformed, or a rule says no) would be refused forever: let it go
        // (more waiting - a batch that stopped at a counter's bound: the rest soon)
        if(r.ok||r.status===400||r.status===401||r.status===403){ boxLock(function(){ dropIds(ids); if(r.ok&&readBox().length) setTimeout(function(){ flush(); },1500); }); return; }
        // no network, a server error: the next flush tries again
        boxLock(function(){ unclaim(ids); });
      });
    });
  }

  /* ---------------------------------------------------------------- what is tracked, and the gates */
  var gate=null;   // the sold gate on screen: {u, yes}
  function trackView(c){
    if(gate&&gate.u===c) gate.yes=true;
    if(UNITS.indexOf(c)<0) return;
    // the same unit on this device within 10 minutes is one view (back and forth between the floors and the calculator)
    var seen=lsGet(K_SEEN)||{}, now=Date.now();
    if(seen[c]&&now-seen[c]<VIEW_DEDUPE_MS&&now>=seen[c]) return;
    seen[c]=now;
    Object.keys(seen).forEach(function(k){ if(UNITS.indexOf(k)<0||now-seen[k]>VIEW_DEDUPE_MS) delete seen[k]; });
    seen[c]=now; lsSet(K_SEEN,seen);
    window.mzTrack('view',{u:c});
  }
  function watchSoldGate(c){
    var o=document.getElementById('soldOverlay');
    if(!o||!o.classList.contains('open')||typeof MutationObserver!=='function') return;
    if(gate&&gate.mo) gate.mo.disconnect();
    var g={u:c,yes:false,mo:null};
    // the gate's own "yes" closes it and then calls selectApt(code) in the same click: the observer runs after both
    g.mo=new MutationObserver(function(){
      if(o.classList.contains('open')) return;
      g.mo.disconnect(); if(gate===g) gate=null;
      window.mzTrack('gate',{u:g.u,st:'sold',res:g.yes?'yes':'no'});
    });
    g.mo.observe(o,{attributes:true,attributeFilter:['class']});
    gate=g;
  }
  function installWrappers(){
    var sel=window.selectApt;
    if(typeof sel==='function'&&!sel.__mza){
      var ws=function(code){ try{ trackView(code); }catch(e){} return sel.apply(this,arguments); };
      ws.__mza=1; window.selectApt=ws;
    }
    // the FINAL openPlanModal: harbour-interior-js and harbour-floorrender-js wrap it before this file runs
    var opm=window.openPlanModal;
    if(typeof opm==='function'&&!opm.__mza){
      var wp=function(){ try{ window.mzTrack('plan',{u:window.__apt||''}); }catch(e){} return opm.apply(this,arguments); };
      wp.__mza=1; window.openPlanModal=wp;
    }
    var sg=window.soldGate;
    if(typeof sg==='function'&&!sg.__mza){
      var wg=function(code){ var r=sg.apply(this,arguments); try{ watchSoldGate(code); }catch(e){} return r; };
      wg.__mza=1; window.soldGate=wg;
    }
  }
  // The reserved unit's gate: the SOLD card's glass and buttons (sold-style), its own words.
  function resTexts(o){
    var h=o.querySelector('h3'), p=o.querySelector('p'), y=o.querySelector('.sold-yes'), n=o.querySelector('.sold-no');
    o.setAttribute('dir',L('rtl','ltr'));
    if(h) h.textContent=L('הדירה שמורה','This apartment is reserved');
    if(p) p.textContent=L('האם להיכנס לעמוד הדירה בכל זאת?','Open the apartment page anyway?');
    if(y) y.textContent=L('כן','Yes');
    if(n) n.textContent=L('לא','No');
  }
  window.mzReservedGate=function(code){
    var o=document.getElementById('mzaResOverlay');
    if(!o){ o=document.createElement('div'); o.id='mzaResOverlay'; o.className='sold-overlay'; document.body.appendChild(o); }
    o.innerHTML='<div class="sold-card" role="dialog" aria-modal="true" aria-labelledby="mzaResT"><h3 id="mzaResT"></h3><p></p>'+
      '<div class="sold-btns"><button type="button" class="sold-btn sold-yes"></button><button type="button" class="sold-btn sold-no"></button></div></div>';
    resTexts(o);
    var prev=document.activeElement, closed=false;
    function close(yes){
      if(closed) return; closed=true;
      o.classList.remove('open'); o.onclick=null; window.removeEventListener('keydown',onKey,true);
      window.mzTrack('gate',{u:code,st:'reserved',res:yes?'yes':'no'});
      if(yes){ if(typeof window.selectApt==='function') window.selectApt(code); }
      else { try{ if(prev&&prev.focus) prev.focus({preventScroll:true}); }catch(e){} }
    }
    // Escape here closes this card only - not the page's own Escape handlers underneath
    function onKey(e){ if(e.key==='Escape'||e.key==='Esc'){ e.preventDefault(); e.stopImmediatePropagation(); close(false); } }
    o.querySelector('.sold-yes').onclick=function(){ close(true); };
    o.querySelector('.sold-no').onclick=function(){ close(false); };
    o.onclick=function(e){ if(e.target===o) close(false); };
    window.addEventListener('keydown',onKey,true);
    o.classList.add('open');
    // on the safe answer: a stray Enter (or a clicker's) must not open a reserved apartment
    setTimeout(function(){ try{ o.querySelector('.sold-no').focus({preventScroll:true}); }catch(e){} },30);
  };

  /* ---------------------------------------------------------------- the session */
  // {idToken, refreshToken, uid, email, exp, used} in sessionStorage: used = the last time his hand was on the admin card
  // (a click, a key, typing, a tap, the wheel) or it was closed. These are shared presentation devices - an iPad handed
  // to a client, the TV PC: once the card has been left alone for IDLE_MS the session is over, whether the card is
  // closed (the lock asks him to sign in) or still open (it swaps itself for the sign-in card: idleLock). The ID token,
  // an hour long, is renewed with the refresh token when it has less than 5 minutes left. The password is never kept.
  var memAuth=null;
  function readAuth(){ var t=null; try{ t=JSON.parse(sessionStorage.getItem(K_AUTH)||'null'); }catch(e){ t=null; } return t&&typeof t==='object'?t:memAuth; }
  function saveAuth(){ try{ sessionStorage.setItem(K_AUTH,JSON.stringify(memAuth)); }catch(e){} }
  function idleOut(){ var t=readAuth(); return !!(t&&t.idToken)&&Date.now()-(+t.used||0)>IDLE_MS; }
  function getAuth(){
    var t=readAuth();
    if(!t||!t.idToken||!t.refreshToken||!t.uid) return null;
    if(idleOut()){ clearAuth(); return null; }
    return t;
  }
  function setAuth(a){ memAuth=a; saveAuth(); }
  function touchAuth(){ var t=readAuth(), now=Date.now(); if(t&&t.idToken&&now-(+t.used||0)>5000){ t.used=now; memAuth=t; saveAuth(); } }
  // his hand on the card, unless it comes after IDLE_MS away: that one does not wake the session up again
  function useAuth(){ if(view==='admin'&&!idleOut()) touchAuth(); }
  function clearAuth(){ memAuth=null; try{ sessionStorage.removeItem(K_AUTH); }catch(e){} }
  // An ID token good for the next few minutes: {ok:true,token} or {ok:false,error:'auth'} (no session, or Google would
  // not renew it - sign in again) / 'offline'. force: renew now (the database said the token has expired).
  var refreshing=null;
  function freshToken(force){
    var a=getAuth(); if(!a) return Promise.resolve({ok:false,error:'auth'});
    if(!force&&+a.exp-Date.now()>REFRESH_EARLY) return Promise.resolve({ok:true,token:a.idToken});
    if(refreshing) return refreshing;
    refreshing=sts(a.refreshToken).then(function(r){
      refreshing=null;
      var d=r.ok&&r.data, b=readAuth();
      if(!b||b.refreshToken!==a.refreshToken) return b&&b.idToken?{ok:true,token:b.idToken}:{ok:false,error:'auth'};   // signed out (or in again) meanwhile
      if(d&&d.id_token&&d.refresh_token){
        b.idToken=String(d.id_token); b.refreshToken=String(d.refresh_token); b.exp=Date.now()+(+d.expires_in||3600)*1000;
        setAuth(b);
        return {ok:true,token:b.idToken};
      }
      // no network (or Google is down): the token in hand while it lasts
      if(r.error==='offline'||r.status>=500) return +b.exp>Date.now()+30000?{ok:true,token:b.idToken}:{ok:false,error:'offline'};
      clearAuth();
      return {ok:false,error:'auth',code:r.code};
    });
    return refreshing;
  }
  function rememberedEmail(){ try{ return localStorage.getItem(K_EMAIL)||''; }catch(e){ return ''; } }

  /* ---------------------------------------------------------------- error words */
  // Identity Toolkit's words (DESIGN.md "Auth"): a wrong e-mail and a wrong password are one answer (the project's
  // e-mail enumeration protection says INVALID_LOGIN_CREDENTIALS for both)
  function authCodeText(code){
    code=String(code||'');
    if(/^(INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND)$/.test(code)) return L('האימייל או הסיסמה שגויים.','Wrong e-mail or password.');
    if(code==='TOO_MANY_ATTEMPTS_TRY_LATER') return L('יותר מדי ניסיונות. המתינו כמה דקות ונסו שוב, או בחרו סיסמה חדשה דרך "שכחתי סיסמה".','Too many attempts. Wait a few minutes and try again, or choose a new password with "Forgot password".');
    if(code==='USER_DISABLED') return L('החשבון הזה הושבת.','This account has been disabled.');
    if(code==='INVALID_EMAIL'||code==='MISSING_EMAIL') return L('כתובת האימייל אינה תקינה.','The e-mail address is not valid.');
    if(code==='MISSING_PASSWORD') return L('יש להזין סיסמה.','Enter the password.');
    return '';
  }
  function errText(r){
    var e=r&&r.error;
    if(e==='offline') return L('אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.','No connection to the server. Check the internet connection and try again.');
    if(e==='auth') return L('הכניסה פגה. היכנסו שוב.','The session has expired. Sign in again.');
    if(e==='idle') return L('מסך הניהול ננעל אחרי 10 דקות בלי שימוש. היכנסו שוב.','The admin screen locked after 10 minutes without use. Sign in again.');
    if(e==='not_admin') return L('לחשבון הזה אין הרשאה למסך הניהול.','This account is not an admin of this screen.');
    if(e==='email') return L('הזינו את כתובת האימייל.','Enter the e-mail address.');
    if(e==='email_first') return L('הזינו את כתובת האימייל, ואז לחצו שוב על "שכחתי סיסמה".','Enter the e-mail address, then press "Forgot password" again.');
    if(e==='stale') return L('השמירה לא בוצעה: הנתונים השתנו בינתיים במכשיר אחר. השינויים שלכם עדיין כאן - בדקו אותם ושמרו שוב.','Not saved: the data changed on another device meanwhile. Your changes are still here - check them and save again.');
    if(e==='denied') return L('השרת לא קיבל את השינוי. נסו שוב; אם זה חוזר, צאו ממסך הניהול והיכנסו מחדש.','The server refused the change. Try again; if it happens again, sign out and sign in again.');
    if(e==='conflict') return L('הערך השתנה מאז, ולכן אי אפשר לבטל את השינוי הזה.','The value has changed since, so this change cannot be undone.');
    var t=r&&r.code?authCodeText(r.code):'';
    if(t) return t;
    if(e==='http'&&r.status===400) return L('הבקשה לא התקבלה (נתונים לא תקינים).','The request was refused (invalid data).');
    return L('שגיאה בשרת. נסו שוב.','Server error. Please try again.');
  }

  /* ---------------------------------------------------------------- the overlay */
  var ov=null, view=null, lastFocus=null, entryBtn=null, downOnBackdrop=false;
  // the sign-in card: busy = signing in, resetBusy = asking for the reset e-mail, err = what went wrong, info = 'reset'
  var signUi={busy:false,resetBusy:false,err:null,info:null};
  // saveErr: why the last save failed ({error,...} - its words drawn in the language on screen), '' when it did not;
  // uid: the account the card was last open for (its unsaved changes are that account's); devDue: the device list owes a
  // redraw (it had the focus when new numbers came)
  var adm={tab:'units',pending:{},ptext:{},saving:false,saveErr:'',rep:null,repAt:0,repRange:30,repLoaded:-1,repFrom:0,repLoading:false,repErr:null,repSeq:0,dev:'',devDue:false,labelText:null,busy:{},after:null,closeAfterSave:false,uid:''};

  function ensureOverlay(){
    if(ov) return ov;
    ov=document.createElement('div'); ov.id='mzaOverlay'; ov.className='mza-overlay';
    ov.addEventListener('pointerdown',function(e){ downOnBackdrop=e.target===ov; useAuth(); });
    // scrolling through the statistics or the log is using the card too (the wheel: below)
    ov.addEventListener('touchmove',useAuth,{passive:true});
    ov.addEventListener('click',onClick);
    ov.addEventListener('input',onInput);
    ov.addEventListener('change',onChange);
    ov.addEventListener('keydown',onKeydown);
    ov.addEventListener('focusout',onFocusOut);
    // the sign-in form: Enter in either field or the button (the page never navigates)
    ov.addEventListener('submit',function(e){ e.preventDefault(); if(view==='signin') signIn(); });
    // wheel-anywhere scrolls the page from anywhere: inside the card, only the card's own list scrolls
    ov.addEventListener('wheel',function(e){
      useAuth();
      var sc=e.target&&e.target.closest?e.target.closest('.mza-scroll,.mza-small'):null;
      if(!sc||sc.scrollHeight<=sc.clientHeight+2) e.preventDefault();
    },{passive:false});
    document.body.appendChild(ov);
    return ov;
  }
  function isOpen(){ return !!(ov&&ov.classList.contains('open')); }
  function openView(v){
    ensureOverlay();
    if(!isOpen()&&!lastFocus) lastFocus=document.activeElement;
    view=v; render();
    ov.classList.add('open');
    document.documentElement.classList.add('mza-open');
    focusFirst();
  }
  function hasUnsaved(){ return pendingCount()>0||Object.keys(adm.ptext).length>0; }
  // force: close even with unsaved changes (he chose to drop them, or they were just saved). Without it, the admin card
  // with changes not yet saved asks first - they would otherwise wait unseen and go out with the next person's Save.
  function closeOverlay(force){
    if(!ov) return;
    if(!force&&view==='admin'&&!adm.saving&&hasUnsaved()){ askClose(); return; }
    useAuth();
    ov.classList.remove('open'); ov.innerHTML=''; view=null;
    document.documentElement.classList.remove('mza-open');
    // a save waiting for the sign-in runs only if THAT sign-in card is answered: not at some later sign-in
    adm.after=null; adm.closeAfterSave=false;
    if(!signUi.busy&&!signUi.resetBusy){ signUi.err=null; signUi.info=null; }
    var f=(lastFocus&&lastFocus!==document.body&&document.contains(lastFocus))?lastFocus:entryBtn; lastFocus=null;
    try{ if(f&&f.focus) f.focus({preventScroll:true}); }catch(e){}
  }
  function confirmEl(){ return ov&&ov.querySelector('.mza-confirm'); }
  function askClose(){
    var card=ov&&ov.querySelector('.mza-admin'); if(!card) return;
    if(!confirmEl()){
      var n=pendingCount(), canSave=n>0&&!anyBad();
      card.insertAdjacentHTML('beforeend','<div class="mza-confirm"><div class="mza-card mza-small" role="alertdialog" aria-modal="true" aria-labelledby="mzaCfT" aria-describedby="mzaCfD">'+
        '<h3 id="mzaCfT">'+L('לסגור בלי לשמור?','Close without saving?')+'</h3>'+
        '<p id="mzaCfD">'+(n?L(n===1?'יש שינוי אחד שלא נשמר.':'יש '+n+' שינויים שלא נשמרו.',n===1?'1 change has not been saved.':n+' changes have not been saved.'):L('יש מחיר שהוקלד ולא נשמר.','A typed price has not been saved.'))+'</p>'+
        '<div class="mza-btns">'+(canSave?'<button type="button" class="mza-btn mza-yes" data-act="cf-save">'+L('שמירה וסגירה','Save and close')+'</button>':'')+
        '<button type="button" class="mza-btn mza-no" data-act="cf-drop">'+L('סגירה בלי לשמור','Close without saving')+'</button>'+
        '<button type="button" class="mza-btn mza-no" data-act="keep">'+L('המשך עריכה','Keep editing')+'</button></div></div></div>');
    }
    var k=ov.querySelector('.mza-confirm [data-act="keep"]'); try{ if(k) k.focus({preventScroll:true}); }catch(e){}
  }
  function dropConfirm(){ var c=confirmEl(); if(c) c.parentNode.removeChild(c); }
  function focusFirst(){
    setTimeout(function(){
      if(!isOpen()) return;
      // a field or button of the new card already has the focus (a quick tap, a busy TV PC running this timer late):
      // it keeps it - taking it would blur the price he is typing
      var a0=document.activeElement; if(a0&&a0!==ov&&ov.contains(a0)) return;
      var em=ov.querySelector('#mzaEmail:not(:disabled)');
      var f=(em&&!em.value?em:null)||ov.querySelector('#mzaPass:not(:disabled)')||ov.querySelector('.mza-tab[aria-selected="true"]')||ov.querySelector('.mza-btn:not(:disabled)');
      try{ if(f) f.focus({preventScroll:true}); }catch(e){}
    },40);
  }
  function render(){
    if(!ov) return;
    ov.setAttribute('dir',L('rtl','ltr'));
    ov.setAttribute('lang',L('he','en'));
    if(view==='signin'){ ov.innerHTML=signHtml(); signRefresh(); }
    else if(view==='admin'){ ov.innerHTML=adminHtml(); var f=ov.querySelector('#mzaFoot'); if(f) setFoot(f); }
  }
  // Escape closes (or, over the "close without saving?" question, keeps editing), Tab stays inside the card; the
  // page's own key handlers (its Escape closes sections) never see them
  window.addEventListener('keydown',function(e){
    if(!isOpen()) return;
    // the first key after IDLE_MS away locks the card instead (and goes no further: no character typed, nothing closed)
    if(idleLock()){ e.preventDefault(); e.stopImmediatePropagation(); return; }
    if(e.key==='Escape'||e.key==='Esc'){ e.preventDefault(); e.stopImmediatePropagation(); if(confirmEl()) dropConfirm(); else closeOverlay(); return; }
    if(e.key==='Tab'){
      var scope=confirmEl()||ov;
      var list=Array.prototype.filter.call(scope.querySelectorAll('button,input,select,[tabindex="0"]'),function(x){ return !x.disabled&&x.offsetParent!==null&&x.getAttribute('tabindex')!=='-1'; });
      if(!list.length) return;
      var a=document.activeElement, first=list[0], last=list[list.length-1];
      if(!scope.contains(a)){ e.preventDefault(); first.focus(); }
      else if(e.shiftKey&&a===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey&&a===last){ e.preventDefault(); first.focus(); }
    }
  },true);

  /* the entry: a discreet lock beside "מפרט דירות" */
  var LOCK_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>';
  function labelEntry(){ if(!entryBtn) return; var t=L('ניהול דירות','Apartment admin'); entryBtn.setAttribute('aria-label',t); entryBtn.setAttribute('title',t); }
  function addEntry(){
    var h=document.querySelector('#plots h3.apt-spec-head')||document.querySelector('h3.apt-spec-head');
    if(!h||h.querySelector('.mza-lock')) return;
    entryBtn=document.createElement('button');
    entryBtn.type='button'; entryBtn.className='mza-lock'; entryBtn.innerHTML=LOCK_SVG;
    labelEntry();
    entryBtn.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); openEntry(); });
    h.appendChild(entryBtn);
  }
  function openEntry(){
    if(!isOpen()) lastFocus=entryBtn;   // closing gives the focus back to the lock
    adm.after=null;
    if(getAuth()) openAdmin(); else openView('signin');
  }

  /* the sign-in card: his e-mail and the password he chose (Google keeps it; this page only passes it on, once) */
  function signHtml(){
    return '<div class="mza-card mza-small" role="dialog" aria-modal="true" aria-labelledby="mzaSiT" aria-describedby="mzaSiD">'+
      '<h3 id="mzaSiT">'+L('כניסה למסך הניהול','Admin sign-in')+'</h3>'+
      '<p id="mzaSiD">'+L('היכנסו עם האימייל והסיסמה של חשבון הניהול.','Sign in with the admin account\'s e-mail and password.')+'</p>'+
      waitingHtml()+
      '<form id="mzaSignForm" novalidate>'+
      '<label class="mza-lbl" for="mzaEmail">'+L('אימייל','E-mail')+'</label>'+
      '<input id="mzaEmail" class="mza-input mza-wide" type="email" name="username" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="254" dir="ltr" value="'+esc(rememberedEmail())+'">'+
      '<label class="mza-lbl" for="mzaPass">'+L('סיסמה','Password')+'</label>'+
      '<input id="mzaPass" class="mza-input mza-wide" type="password" name="password" autocomplete="current-password" maxlength="200" dir="ltr">'+
      '<p class="mza-err" id="mzaSiErr" role="alert"></p>'+
      '<div class="mza-btns"><button type="submit" class="mza-btn mza-yes" id="mzaSiGo" data-act="login"></button>'+
      '<button type="button" class="mza-btn mza-no" data-act="close">'+L('ביטול','Cancel')+'</button></div>'+
      '<p class="mza-forgot"><button type="button" class="mza-linkbtn mza-gold" id="mzaForgot" data-act="forgot"></button></p>'+
      '</form></div>';
  }
  // the open card asked for this sign-in with changes not yet saved: they wait for it (enterAdmin) - closing this card
  // instead lets them go
  function waitingHtml(){
    if(!hasUnsaved()||(adm.after!=='save'&&adm.after!=='keep')) return '';
    return '<p class="mza-note" id="mzaSiWait">'+(adm.after==='save'?L('השינויים שלא נשמרו יישמרו מיד אחרי הכניסה.','Your unsaved changes will be saved as soon as you sign in.'):L('השינויים שלא נשמרו ימתינו לכם אחרי הכניסה.','Your unsaved changes will be waiting after you sign in.'))+'</p>';
  }
  // the card's state in place - the fields keep what is typed in them (a redraw would empty the password)
  function signRefresh(){
    if(view!=='signin'||!ov) return;
    var busy=signUi.busy||signUi.resetBusy;
    ['#mzaEmail','#mzaPass'].forEach(function(s){ var i=ov.querySelector(s); if(i) i.disabled=busy; });
    var go=ov.querySelector('#mzaSiGo'), fg=ov.querySelector('#mzaForgot'), er=ov.querySelector('#mzaSiErr');
    if(go){ go.disabled=busy; go.textContent=signUi.busy?L('בודק…','Checking…'):L('כניסה','Sign in'); }
    if(fg){ fg.disabled=busy; fg.textContent=signUi.resetBusy?L('שולח…','Sending…'):L('שכחתי סיסמה','Forgot password'); }
    if(er){
      er.textContent=signUi.err?errText(signUi.err):signUi.info==='reset'?L('אם לכתובת הזו יש חשבון, נשלח אליה מייל עם קישור לבחירת סיסמה חדשה (בדקו גם בתיקיית הספאם).','If this address has an account, an e-mail with a link to choose a new password was sent to it (check the spam folder too).'):'';
      er.classList.toggle('mza-info',!signUi.err&&!!signUi.info);
    }
  }
  function signFocus(sel){ setTimeout(function(){ var i=ov&&ov.querySelector(sel); try{ if(i&&!i.disabled){ i.focus({preventScroll:true}); if(i.select) i.select(); } }catch(e){} },30); }
  function signIn(){
    if(signUi.busy||signUi.resetBusy||!ov) return;
    var ei=ov.querySelector('#mzaEmail'), pi=ov.querySelector('#mzaPass');
    var email=String(ei&&ei.value||'').trim(), pass=String(pi&&pi.value||'');
    signUi.info=null;
    signUi.err=!email?{error:'email'}:!EMAIL_RE.test(email)?{error:'http',code:'INVALID_EMAIL'}:!pass?{error:'http',code:'MISSING_PASSWORD'}:null;
    if(signUi.err){ signRefresh(); signFocus(!email||!EMAIL_RE.test(email)?'#mzaEmail':'#mzaPass'); return; }
    signUi.busy=true; signRefresh();
    idt('signInWithPassword',{email:email,password:pass,returnSecureToken:true}).then(function(r){
      pass='';
      var d=r.ok&&r.data;
      if(!(d&&d.idToken&&d.refreshToken&&d.localId)) return r.ok?{ok:false,error:'http'}:r;
      var a={idToken:String(d.idToken),refreshToken:String(d.refreshToken),uid:String(d.localId),email:String(d.email||email),exp:Date.now()+(+d.expiresIn||3600)*1000,used:Date.now()};
      // an account of this project is not yet an admin of this screen: the database says who is (admins/{uid}, which
      // only the setup script writes) - anyone else's session is dropped here
      return dbGet('admins/'+encodeURIComponent(a.uid),{auth:a.idToken}).then(function(g){
        if(g.ok&&g.data===true) return {ok:true,auth:a};
        return g.ok||g.status===401||g.status===403?{ok:false,error:'not_admin'}:g;
      });
    }).then(function(r){
      signUi.busy=false;
      if(view!=='signin'){ signUi.err=null; return; }   // he closed the card meanwhile: no session, nothing opens
      if(r.ok){
        setAuth(r.auth);
        try{ localStorage.setItem(K_EMAIL,r.auth.email); }catch(e){}
        var pw=ov&&ov.querySelector('#mzaPass'); if(pw) pw.value='';
        signUi.err=null;
        enterAdmin();
        return;
      }
      signUi.err=r;
      signRefresh();
      signFocus(r.code==='INVALID_EMAIL'?'#mzaEmail':'#mzaPass');
    });
  }
  // "Forgot password": Google e-mails a link to its own page, where he chooses the new one. The answer is the same
  // whether or not the address has an account (nothing here tells anyone which addresses do); only "no network" differs.
  function sendReset(email){ return idt('sendOobCode',{requestType:'PASSWORD_RESET',email:email},isEn()?'en':'he'); }
  function forgot(){
    if(signUi.busy||signUi.resetBusy||!ov) return;
    var ei=ov.querySelector('#mzaEmail'), email=String(ei&&ei.value||'').trim();
    signUi.info=null;
    if(!EMAIL_RE.test(email)){ signUi.err=email?{error:'http',code:'INVALID_EMAIL'}:{error:'email_first'}; signRefresh(); signFocus('#mzaEmail'); return; }
    signUi.resetBusy=true; signUi.err=null; signRefresh();
    sendReset(email).then(function(r){
      signUi.resetBusy=false;
      if(r.error==='offline') signUi.err=r; else signUi.info='reset';
      signRefresh();
    });
  }
  // The session is over: the sign-in card. Asked from inside the open admin card (the session could not be renewed under
  // his hands, or the card locked itself) what he has not saved waits for that sign-in ('keep'; 'save': and is saved).
  function needLogin(r,after){
    var inCard=view==='admin'&&isOpen();
    clearAuth(); adm.after=after||(inCard?'keep':null);
    signUi.err=r&&r.error?r:null; signUi.info=null;
    openView('signin');
  }
  // The open card locks itself after IDLE_MS without his hand on it (a timer, his next key or click, the page shown
  // again): the statistics and the log go off the screen with it. Never in the middle of a save.
  function idleLock(){
    if(view!=='admin'||!isOpen()||adm.saving||!idleOut()) return false;
    needLogin({error:'idle'});
    return true;
  }
  // Signed in. A sign-in the open card asked for picks up where it was, for the same account: the waiting save goes
  // through, the unsaved changes are still there. Any other sign-in - from the lock, or by another account - starts clean:
  // changes left pending by an earlier session on this device are not saved along with this one's.
  function enterAdmin(){
    var after=adm.after, a=readAuth(), same=!!(a&&adm.uid&&a.uid===adm.uid); adm.after=null;
    if(!same||(after!=='save'&&after!=='keep')){ adm.pending={}; adm.ptext={}; after=null; }
    if(after!=='save') adm.closeAfterSave=false;
    openAdmin();
    if(after==='save') save();
  }

  /* ---------------------------------------------------------------- the admin card */
  function openAdmin(){
    var a=readAuth(); adm.uid=a&&a.uid||'';
    adm.saveErr='';
    openView('admin');
    if(!stream.es) openStream();
    fetchState();
    loadRep(false,300000);   // the statistics: again when the card opens if they are older than 5 minutes
  }
  function connHtml(){
    var off=net.state==='off';
    return '<span class="mza-conn'+(off?' off':'')+'" id="mzaConn">'+(off?L('לא מקוון','Offline'):net.state==='on'?L('מחובר','Connected'):L('מתחבר…','Connecting…'))+'</span>';
  }
  function refreshConn(){ var c=ov&&ov.querySelector('#mzaConn'); if(c) c.outerHTML=connHtml(); }
  var TABS=[['units','דירות','Apartments'],['stats','סטטיסטיקה','Statistics'],['log','יומן','Log'],['settings','הגדרות','Settings']];
  function adminHtml(){
    return '<div class="mza-card mza-admin" role="dialog" aria-modal="true" aria-labelledby="mzaTitle">'+
      '<div class="mza-head"><h3 id="mzaTitle">'+L('ניהול דירות','Apartment admin')+'<span class="mza-sub" dir="ltr">THE HARBOUR</span></h3>'+connHtml()+
      '<button type="button" class="mza-x" data-act="close" aria-label="'+L('סגירה','Close')+'">×</button></div>'+
      '<div class="mza-tabs" role="tablist" aria-label="'+L('מסך הניהול','Admin screen')+'">'+TABS.map(function(t){
        var on=adm.tab===t[0];
        return '<button type="button" role="tab" class="mza-tab" id="mzaTab-'+t[0]+'" data-tab="'+t[0]+'" aria-selected="'+on+'" aria-controls="mzaPanel" tabindex="'+(on?0:-1)+'">'+L(t[1],t[2])+'</button>';
      }).join('')+'</div>'+
      '<div class="mza-scroll" id="mzaPanel" role="tabpanel" aria-labelledby="mzaTab-'+adm.tab+'">'+panelHtml()+'</div>'+
      '<div class="mza-foot" id="mzaFoot"'+(adm.tab==='units'?'':' hidden')+'></div>'+
      '<div class="mza-toast" id="mzaToast" role="status" aria-live="polite"></div></div>';
  }
  function panelHtml(){
    if(adm.tab==='stats') return statsHtml();
    if(adm.tab==='log') return logHtml();
    if(adm.tab==='settings') return settingsHtml();
    return unitsHtml();
  }
  // the panel again, the scroll kept (keepScroll) or back at the top
  function renderPanel(keepScroll){
    if(view!=='admin'||!ov) return;
    var p=ov.querySelector('#mzaPanel'), f=ov.querySelector('#mzaFoot'); if(!p) return;
    var top=p.scrollTop;
    p.innerHTML=panelHtml(); adm.devDue=false;
    p.scrollTop=keepScroll?top:0;
    if(f){ setFoot(f); f.hidden=adm.tab!=='units'; }
    refreshConn();
  }
  // new data arrived: the panel again - but while he types in a field (a price, the device's name) or has the device list
  // open, that element is left as it is and everything around it is drawn in place (refreshAround)
  function softRefresh(){
    if(view!=='admin'||!ov) return;
    var a=document.activeElement;
    if(a&&ov.contains(a)&&(a.tagName==='INPUT'||a.tagName==='SELECT')){ refreshAround(a); refreshConn(); return; }
    var fb=a&&ov.contains(a)?focusKey(a):null;
    renderPanel(true);
    if(fb) refocus(fb);
  }
  // Only what changed, and never by a redraw on the way out of the field: focusout comes with the press on whatever he
  // goes to next, and an element drawn again between the press and the release swallows that click.
  // - units: every other unit whose state is no longer the one drawn (data-sig) is drawn again; the one he types in
  //   keeps its field and gets its pills, look and line; then the footer and the note;
  // - statistics: the ranges, Refresh and the numbers; the device list itself waits for its focusout (devDue);
  // - settings: the connection box (the name field is in another).
  function refreshAround(a){
    if(adm.tab==='units'){
      var fu=a.getAttribute('data-p');
      UNITS.forEach(function(c){
        var el=ov.querySelector('.mza-unit[data-u="'+c+'"]');
        if(!el||el.getAttribute('data-sig')===unitSig(c)) return;
        if(c===fu) refreshUnitLook(c); else refreshUnit(c);
      });
      var n=ov.querySelector('#mzaUnitsNote'); if(n) n.innerHTML=unitsNote();
      refreshFoot();
    } else if(adm.tab==='stats'){
      var rg=ov.querySelector('#mzaRanges'), rb=ov.querySelector('#mzaRepReload'), body=ov.querySelector('#mzaRepBody');
      if(rg) rg.innerHTML=rangeChips();
      if(rb) rb.outerHTML=reloadBtn('mzaRepReload');
      if(body) body.innerHTML=repBodyHtml();
      if(a.id==='mzaDev') adm.devDue=true; else devRefresh();
    } else if(adm.tab==='settings'){
      var cs=ov.querySelector('#mzaSetConn'); if(cs) cs.outerHTML=connSetHtml();
    }
  }
  function focusKey(el){ return {id:el.id,act:el.getAttribute('data-act'),tab:el.getAttribute('data-tab'),s:el.getAttribute('data-s'),u:(el.closest('[data-u]')||{getAttribute:function(){return null;}}).getAttribute('data-u'),range:el.getAttribute('data-range'),lid:el.getAttribute('data-id')}; }
  function refocus(k){
    var q=k.id?'#'+k.id:k.tab?'[data-tab="'+k.tab+'"]':k.s&&k.u?'[data-u="'+k.u+'"] [data-s="'+k.s+'"]':k.range!=null?'[data-range="'+k.range+'"]':k.lid?'[data-id="'+k.lid+'"]':k.act?'[data-act="'+k.act+'"]':null;
    var el=q&&ov.querySelector(q);
    try{ if(el&&!el.disabled) el.focus({preventScroll:true}); }catch(e){}
  }
  function toast(msg,bad){
    var t=ov&&ov.querySelector('#mzaToast'); if(!t) return;
    var f=ov.querySelector('#mzaFoot'), fh=f&&!f.hidden?f.offsetHeight:0;
    t.style.bottom=(fh?fh+12:16)+'px';   // above the footer: never over Save, Cancel or the footer's own error line
    t.textContent=msg; t.classList.toggle('bad',!!bad); t.classList.add('on');
    clearTimeout(toast.t); toast.t=setTimeout(function(){ t.classList.remove('on'); },bad?5200:3200);
  }
  function setTab(t){
    if(TABS.every(function(x){ return x[0]!==t; })) return;
    adm.tab=t; render();
    var b=ov.querySelector('[data-tab="'+t+'"]'); try{ if(b) b.focus({preventScroll:true}); }catch(e){}
    if(t!=='units') loadRep(false);
  }

  /* -- tab 1: the units */
  function pend(c){ return adm.pending[c]||{}; }
  function pendingCount(){ var n=0; Object.keys(adm.pending).forEach(function(c){ var p=adm.pending[c]; if('s' in p) n++; if('p' in p) n++; }); return n; }
  function anyBad(){ return Object.keys(adm.ptext).some(function(c){ return priceCheck(c).bad; }); }
  function priceCheck(c){
    var t=adm.ptext[c], b=baseUnits()[c]||{};
    if(t==null) return {bad:false,val:'p' in pend(c)?pend(c).p:b.p};
    var d=digits(t);
    if(!d) return {bad:true,msg:L('יש להזין מחיר.','Enter a price.')};
    var n=parseInt(d,10);
    if(n<PRICE_MIN||n>PRICE_MAX) return {bad:true,msg:L('הזינו מחיר בין '+ltr('€10,000')+' ל-'+ltr('€5,000,000')+'.','Enter a price between €10,000 and €5,000,000.')};
    return {bad:false,val:n};
  }
  function prunePending(){
    var base=baseUnits();
    Object.keys(adm.pending).forEach(function(c){
      var p=adm.pending[c], b=base[c];
      if(b&&p.s===b.s) delete p.s;
      if(b&&p.p===b.p&&adm.ptext[c]==null) delete p.p;
      if(!('s' in p)&&!('p' in p)) delete adm.pending[c];
    });
  }
  function lineHtml(c){
    var b=baseUnits()[c]||{}, p=pend(c), chk=priceCheck(c), out=[];
    if(chk.bad) out.push('<span class="mza-bad-t">'+chk.msg+'</span>');
    else if(c==='Y3'&&chk.val>0&&chk.val<GV_MIN) out.push('<span class="mza-warn-t">'+L('מתחת ל-'+ltr('€250,000')+': הדירה לא תעמוד בתנאי ה-Golden Visa.','Below €250,000: the apartment will no longer qualify for the Golden Visa.')+'</span>');
    var was=[];
    if('s' in p) was.push(stName(b.s));
    if('p' in p) was.push(ltr(eur(b.p)));
    if(was.length) out.push('<span class="mza-was">'+L('לפני השינוי: ','Before: ')+was.join(' · ')+'</span>');
    return out.join('<br>');
  }
  // what a unit's card is drawn from (the language aside: a change of it draws everything): see refreshAround
  function unitSig(c){
    var b=baseUnits()[c]||{}, p=pend(c);
    return JSON.stringify([b.s,b.p,'s' in p?p.s:0,'p' in p?p.p:0,adm.ptext[c]==null?0:adm.ptext[c],adm.saving]);
  }
  function unitHtml(c){
    var b=baseUnits()[c]||{}, p=pend(c), s='s' in p?p.s:b.s, chk=priceCheck(c), dis=adm.saving?' disabled':'';
    var txt=adm.ptext[c]!=null&&chk.bad?adm.ptext[c]:fmtInt(chk.val);
    return '<div class="mza-unit'+(('s' in p)||('p' in p)||chk.bad?' mza-dirty':'')+'" data-u="'+c+'" data-sig="'+esc(unitSig(c))+'">'+
      '<div class="mza-u-head"><b dir="ltr">'+c+'</b><span class="mza-u-name" dir="ltr">'+esc(unitName(c))+'</span>'+(c==='Y3'?'<span class="mza-gv" dir="ltr">GOLDEN VISA</span>':'')+'</div>'+
      '<div class="mza-pills" role="group" aria-label="'+L('סטטוס '+c,'Status of '+c)+'">'+STATUSES.map(function(st){
        return '<button type="button" class="mza-pill mza-p-'+st+(s===st?' on':'')+'" data-s="'+st+'" aria-pressed="'+(s===st)+'"'+dis+'>'+stName(st)+'</button>';
      }).join('')+'</div>'+
      '<label class="mza-price"><span>'+L('מחיר','Price')+'</span><span class="mza-in-wrap" dir="ltr"><span>€</span>'+
      '<input type="text" class="mza-input'+(chk.bad?' mza-bad':'')+'" data-p="'+c+'" inputmode="numeric" autocomplete="off" dir="ltr" value="'+esc(txt)+'" aria-label="'+L('מחיר '+c+' באירו','Price of '+c+' in euros')+'" aria-invalid="'+chk.bad+'"'+dis+'></span></label>'+
      '<p class="mza-line" data-line="'+c+'" aria-live="polite">'+lineHtml(c)+'</p></div>';
  }
  function unitsNote(){
    return L('השינויים מופיעים תוך שניות בכל המכשירים המחוברים (מחשבים, iPad ו-iPhone). מחיר חדש מתעדכן בכפתור הדירה ובחוברות; מחשבון שכבר פתוח נשאר כפי שהוא עד שהדירה נפתחת מחדש.',
      'Changes show within seconds on every connected device (PCs, iPad and iPhone). A new price updates the apartment button and the booklets; a calculator already open stays as it is until the apartment is opened again.')+
      (cur&&cur.src==='server'?'':' '+L('(מוצגים הנתונים האחרונים שבמכשיר.)','(Showing the latest data on this device.)'));
  }
  function unitsHtml(){
    var h='<p class="mza-note" id="mzaUnitsNote">'+unitsNote()+'</p>';
    FLOORS.forEach(function(f){
      h+='<section class="mza-floor" aria-label="'+esc(L(f.he,f.en))+'"><h4>'+L(f.he,f.en)+'</h4><div class="mza-units">';
      UNITS.filter(function(c){ return c.charAt(0)===f.k; }).forEach(function(c){ h+=unitHtml(c); });
      h+='</div></section>';
    });
    return h;
  }
  function footHtml(){
    if(adm.tab!=='units') return '';
    var n=pendingCount(), bad=anyBad();
    if(adm.saving) return '<span class="mza-pend" role="status">'+L('שומר…','Saving…')+'</span><span class="mza-foot-btns"><button type="button" class="mza-btn mza-yes" disabled>'+L('שומר…','Saving…')+'</button></span>';
    // Save is off while a price is invalid: say so, and a press takes him to it (it may be scrolled out of sight)
    var status=bad?'<span class="mza-pend" role="status"><button type="button" class="mza-linkbtn" data-act="gobad">'+L('יש מחיר לא תקין: תקנו אותו כדי לשמור.','Fix the highlighted price to save.')+'</button></span>'
      :'<span class="mza-pend" role="status">'+(n?L(n===1?'שינוי אחד ממתין לשמירה':n+' שינויים ממתינים לשמירה',n===1?'1 change waiting to be saved':n+' changes waiting to be saved'):L('אין שינויים ממתינים','No pending changes'))+'</span>';
    return status+
      '<span class="mza-foot-btns"><button type="button" class="mza-btn mza-yes" data-act="save"'+(n&&!bad?'':' disabled')+'>'+L('שמירה','Save')+' ('+n+')</button>'+
      '<button type="button" class="mza-btn mza-no" data-act="discard"'+(n||Object.keys(adm.ptext).length?'':' disabled')+'>'+L('ביטול','Cancel')+'</button></span>'+
      '<span class="mza-foot-err" role="alert">'+esc(adm.saveErr?errText(adm.saveErr):'')+'</span>';
  }
  // only when it reads differently: a click on "שמירה" right after typing a price blurs the input first, and a footer
  // redrawn between the press and the release would swallow that click
  function setFoot(f){ var h=footHtml(); if(f.__mzaHtml!==h||f.innerHTML===''&&h){ f.innerHTML=h; f.__mzaHtml=h; } }
  function refreshFoot(){ var f=ov&&ov.querySelector('#mzaFoot'); if(f) setFoot(f); }
  function refreshUnit(c,focusS){
    var el=ov&&ov.querySelector('.mza-unit[data-u="'+c+'"]'); if(!el) return;
    el.outerHTML=unitHtml(c);
    if(focusS){ var b=ov.querySelector('.mza-unit[data-u="'+c+'"] [data-s="'+focusS+'"]'); try{ if(b) b.focus({preventScroll:true}); }catch(e){} }
  }
  // while he types the price: the card's look and its line only - the input itself is left alone
  function refreshUnitState(c){
    var el=ov&&ov.querySelector('.mza-unit[data-u="'+c+'"]'); if(!el) return;
    var p=pend(c), chk=priceCheck(c), inp=el.querySelector('input[data-p]'), ln=el.querySelector('[data-line]');
    el.classList.toggle('mza-dirty',('s' in p)||('p' in p)||chk.bad);
    if(inp){ inp.classList.toggle('mza-bad',chk.bad); inp.setAttribute('aria-invalid',String(chk.bad)); }
    if(ln) ln.innerHTML=lineHtml(c);
    el.setAttribute('data-sig',unitSig(c));
  }
  // the same, and its status pills too (another device changed the status while he types its price)
  function refreshUnitLook(c){
    var b=baseUnits()[c]||{}, p=pend(c), s='s' in p?p.s:b.s;
    Array.prototype.forEach.call(ov.querySelectorAll('.mza-unit[data-u="'+c+'"] [data-s]'),function(x){
      var on=x.getAttribute('data-s')===s; x.classList.toggle('on',on); x.setAttribute('aria-pressed',String(on));
    });
    refreshUnitState(c);
  }
  function pickStatus(c,s){
    if(adm.saving||STATUSES.indexOf(s)<0) return;
    var b=baseUnits()[c]; if(!b) return;
    var p=adm.pending[c]||(adm.pending[c]={});
    if(s===b.s) delete p.s; else p.s=s;
    if(!('s' in p)&&!('p' in p)) delete adm.pending[c];
    adm.saveErr='';
    refreshUnit(c,s); refreshFoot();
  }
  function typePrice(c,inp){
    var clean=String(inp.value).replace(/[^\d,]/g,'');
    if(clean!==inp.value) inp.value=clean;
    adm.ptext[c]=clean;
    var chk=priceCheck(c), b=baseUnits()[c], p=adm.pending[c]||(adm.pending[c]={});
    if(!chk.bad&&chk.val!==b.p) p.p=chk.val; else delete p.p;
    if(!('s' in p)&&!('p' in p)) delete adm.pending[c];
    adm.saveErr='';
    refreshUnitState(c); refreshFoot();
  }
  function blurPrice(c,inp){
    var chk=priceCheck(c); if(chk.bad) return;
    delete adm.ptext[c];
    inp.value=fmtInt(chk.val);
    refreshUnitState(c); refreshFoot();
  }
  function discard(){ adm.pending={}; adm.ptext={}; adm.saveErr=''; renderPanel(true); }
  function changeList(){
    var out=[];
    UNITS.forEach(function(c){ var p=adm.pending[c]; if(!p) return; var x={u:c}; if('s' in p) x.s=p.s; if('p' in p) x.p=p.p; if(x.s||x.p) out.push(x); });
    return out;
  }
  // a log entry's key: L + the device's time in base36 (9 digits, so the keys sort by time) + '-' + 4 random
  function logId(taken){
    var t=Date.now().toString(36), id;
    while(t.length<9) t='0'+t;
    do{ id='L'+t+'-'+rand36(4); }while(taken&&own(taken,'log/'+id));
    return id;
  }
  // Optimistic: the page shows the change at once; the database's answer confirms it (the stream too), a failure puts
  // it back. One multi-path write: each changed field, rev + 1 (a write based on a stale rev is refused by the rules -
  // someone saved meanwhile), the database's time, and one log row per field. again: the retry after a renewed session.
  function save(again){
    if(adm.saving) return;
    if(!changeList().length||anyBad()) return;
    if(!getAuth()){ needLogin(null,'save'); return; }
    adm.saving=true; adm.saveErr='';
    renderPanel(true);
    var rev=0, next=null;
    serverState().then(function(s){
      if(!s.ok) return s;
      var ch=changeList(); if(!ch.length) return {ok:true,nothing:true};   // the state that arrived already says it all
      var base=baseUnits(), body={};
      rev=s.none?0:cur.rev; next=copyUnits(base);
      ch.forEach(function(x){
        ['s','p'].forEach(function(f){
          if(!(f in x)) return;
          next[x.u][f]=x[f];
          if(!s.none) body['state/units/'+x.u+'/'+f]=x[f];
          body['log/'+logId(body)]={ts:TS,dev:devId,u:x.u,f:f,from:base[x.u][f],to:x[f]};
        });
      });
      if(s.none) body.state={rev:1,at:TS,units:next};   // nothing there yet: the whole state, rev 1
      else { body['state/rev']=rev+1; body['state/at']=TS; }
      applyUnits(next);
      return freshToken().then(function(t){ return t.ok?dbPatch(body,t.token):t; });
    }).then(function(r){
      adm.saving=false;
      if(r.ok&&r.nothing){ applyUnits(baseUnits()); if(view==='admin') renderPanel(true); return; }
      if(r.ok){
        adm.pending={}; adm.ptext={};
        if(!setState({rev:rev+1,at:Date.now(),units:next},'server')) applyUnits(baseUnits());
        // the log and the counts have changed: a statistics read already on its way (read before this save) is stale too
        adm.rep=null; adm.repSeq++; adm.repLoading=false;
        if(adm.closeAfterSave){ adm.closeAfterSave=false; closeOverlay(true); return; }
        if(view==='admin'){ renderPanel(true); toast(L('נשמר. יופיע בכל המכשירים תוך שניות.','Saved. It will show on every device within seconds.')); }
        return;
      }
      applyUnits(baseUnits());   // back to what was there
      var closeAfter=adm.closeAfterSave; adm.closeAfterSave=false;
      if(r.error==='auth'){ needLogin(r,'save'); return; }
      // Refused: a stale rev (another device saved meanwhile) or a session the database no longer takes. A fresh token
      // if this one is near its end (now, if the database says it expired), the state as it is now; the changes stay
      // pending. Only the session renewed (the same rev): once more by itself; the state moved: he checks and saves.
      if(r.error==='http'&&r.status===401){
        freshToken(/expired/i.test(String(r.code||''))).then(function(t){
          if(!t.ok&&t.error==='auth'){ needLogin(t,'save'); return; }
          fetchState().then(function(){
            var moved=!!(cur&&cur.src==='server'&&cur.rev!==rev);
            if(!moved&&!again&&pendingCount()&&!anyBad()){ adm.closeAfterSave=closeAfter; save(true); return; }
            adm.saveErr={error:moved?'stale':'denied'};
            if(view==='admin'){ renderPanel(true); toast(errText(adm.saveErr),true); }
          });
        });
        return;
      }
      adm.saveErr=r;
      if(view==='admin'){ renderPanel(true); toast(errText(r),true); }
    });
  }

  /* -- the statistics: the counters, the devices, their names and the log, shared by the statistics, the log, the settings */
  // Read again only when it is asked for (רענון, another range: force), when a write dropped it (adm.rep = null), or -
  // opening the card - when older than maxAge: switching tabs never downloads every counter again.
  // again: the read once more after a renewed ID token
  function loadRep(force,maxAge,again){
    if(adm.repLoading&&!force) return;   // a forced load (another range) supersedes the one on its way (repSeq)
    if(!force&&adm.rep&&adm.repLoaded===adm.repRange&&!(maxAge&&Date.now()-adm.repAt>maxAge)) return;
    if(!getAuth()){ if(view==='admin') needLogin(null); return; }
    adm.repLoading=true; adm.repErr=null;
    // The range by this device's calendar: "7 days" = today and the 6 days before it (the counters are kept by day), and
    // never past today - the rules cannot know today, so a counter under a later day (a clock that ran ahead, or written
    // on purpose) would otherwise sort after every real one and stay in every range. "All" stops at today too.
    var range=adm.repRange, today=dayKey(Date.now()), first=range?rangeFirst(range):'', from=range?dayStart(first):0, my=++adm.repSeq;
    if(view==='admin'&&adm.tab!=='units') renderPanel(true);
    freshToken().then(function(t){
      if(!t.ok) return [t];
      var a=t.token;
      return Promise.all([
        dbGet('stats',{auth:a,orderBy:'"$key"',startAt:range?'"'+first+'"':null,endAt:'"'+today+'"'}),
        dbGet('log',{auth:a,orderBy:'"$key"',limitToLast:LOG_MAX}),
        dbGet('devices',{auth:a}),
        dbGet('labels',{auth:a})
      ]);
    }).then(function(rs){
      if(my!==adm.repSeq) return;
      var bad=rs.filter(function(r){ return !r.ok; })[0];
      // refused as expired (the hour ran out between the check and the read): renewed at once, and read once more
      if(bad&&bad.status===401&&!again&&/expired/i.test(String(bad.code||''))){
        freshToken(true).then(function(t){
          if(my!==adm.repSeq) return;
          adm.repLoading=false;
          if(t.ok){ loadRep(true,0,true); return; }
          repDone(t,force);
        });
        return;
      }
      adm.repLoading=false;
      if(!bad){
        adm.rep=makeRep(rs[0].data,rs[1].data,rs[2].data,rs[3].data,today);
        adm.repAt=Date.now(); adm.repLoaded=range; adm.repFrom=from;
      }
      repDone(bad,force);
    });
  }
  // after a read: a session that is over -> the sign-in (from the open card, its unsaved changes wait for it); any other
  // failure stays on the tab, above the numbers (repHead), and - asked for (Refresh, a range) - in a toast too
  function repDone(bad,force){
    if(bad&&(bad.error==='auth'||bad.status===401)){ adm.rep=null; if(view==='admin') needLogin({error:'auth'}); return; }
    if(bad){ adm.repErr=bad; if(force&&view==='admin'&&adm.tab!=='units') toast(errText(bad),true); }
    if(view==='admin'&&adm.tab!=='units') softRefresh();
  }
  // the log as rows, newest first (the keys sort by time), each with its key as id; to: the last day the read covered
  function makeRep(stats,log,devices,labels,to){
    var lg=obj(log), rows=Object.keys(lg).sort().reverse().map(function(id){
      var e=lg[id]; if(!e||typeof e!=='object') return null;
      var o={}; Object.keys(e).forEach(function(k){ o[k]=e[k]; }); o.id=id;
      return o;
    }).filter(Boolean);
    return {stats:obj(stats),log:rows,devices:obj(devices),labels:obj(labels),to:to||''};
  }
  // The read's state, above the numbers: loading, or why it failed and "try again". ranged (the statistics): numbers read
  // for another range than the chip now chosen are never shown under it - only the note; numbers of this range from an
  // earlier read stay under the error, with when they were read. The log is the same in every range.
  function repOther(ranged){ return !adm.rep||!!(ranged&&adm.repLoaded!==adm.repRange); }
  function repHead(ranged){
    var none=repOther(ranged);
    if(adm.repLoading&&none) return '<p class="mza-note" role="status">'+L('טוען נתונים…','Loading…')+'</p>';
    if(adm.repErr) return '<p class="mza-err" role="alert" style="text-align:start">'+esc(errText(adm.repErr))+(none?'':' '+L('מוצגים הנתונים מ-','Showing the data read at ')+ltr(fmtTime(adm.repAt))+'.')+'</p>'+
      '<button type="button" class="mza-btn mza-no mza-sm" data-act="reload">'+L('ניסיון נוסף','Try again')+'</button>';
    return '';
  }
  function reloadBtn(id){ return '<button type="button" class="mza-btn mza-no mza-sm"'+(id?' id="'+id+'"':'')+' data-act="reload"'+(adm.repLoading?' disabled':'')+'>'+(adm.repLoading?L('טוען…','Loading…'):L('רענון','Refresh'))+'</button>'; }
  function devName(id){
    var r=adm.rep, lb=r&&r.labels[id], d=r&&obj(r.devices[id]);
    var n=(typeof lb==='string'&&lb)||(d&&typeof d.host==='string'&&d.host)||(id===devId?device.host:'')||id;
    return n+(id===devId?L(' (המכשיר הזה)',' (this device)'):'');
  }
  var aggMemo={rep:null,from:null,by:{}};   // a redraw of the same reply reuses the sums (all devices, and the one chosen)
  function aggregate(rep,devF,from){
    if(aggMemo.rep!==rep||aggMemo.from!==from) aggMemo={rep:rep,from:from,by:{}};
    var k='#'+(devF||'');
    return aggMemo.by[k]||(aggMemo.by[k]=aggregate0(rep,devF,from));
  }
  // the undo chain's depth: a change 0, its undo 1, a redo (an undo of the undo) 2...; a missing parent (older than the
  // 500 log rows) reads as a change taken back
  function undoDepth(e,byId){
    var d=0, seen={};
    while(e&&e.undoOf!=null&&e.undoOf!==''&&!seen[e.id]){ seen[e.id]=1; d++; e=byId[e.undoOf]; }
    return d;
  }
  // The counters, summed: stats/{day}/{dev}/{unit}/{kind} (the days already the range's). The device and platform bars
  // count what a device did - one per view, plan, booklet, e-mailed booklet, print, gate - not the segments.
  var PER={v:'view',pl:'plan',ex:'export',ml:'mail'}, DID={v:1,pl:1,ex:1,ml:1,pr:1,gs:1}, FIN_IX={fn_0:0,fn_30:1,fn_50:2,fn_51:3};
  function aggregate0(rep,devF,from){
    var per={}, t={view:0,plan:0,export:0,mail:0,rcpt:0,print:0,gate:0,gateYes:0,changes:0};
    UNITS.forEach(function(c){ per[c]={view:0,plan:0,export:0,mail:0,changes:0}; });
    var scen={cons:0,real:0,opt:0}, fin=[0,0,0,0], lang={he:0,en:0}, plat={app:0,pwa:0}, devs={};
    var S=obj(rep.stats);
    Object.keys(S).forEach(function(day){
      if(!realDay(day)||(rep.to&&day>rep.to)) return;   // no such date (2026-02-30), or after the read's today
      var D=obj(S[day]);
      Object.keys(D).forEach(function(dev){
        if(devF&&dev!==devF) return;
        var U=obj(D[dev]), pl=obj(rep.devices[dev]).plat;
        Object.keys(U).forEach(function(u){
          var K=obj(U[u]), x=own(per,u)?per[u]:null;
          Object.keys(K).forEach(function(k){
            var n=+K[k]; if(!(n>0)) return;
            if(own(PER,k)){ t[PER[k]]+=n; if(x) x[PER[k]]+=n; }
            else if(k==='pr') t.print+=n;
            else if(k==='mr') t.rcpt+=n;
            else if(k==='gs') t.gate+=n;
            else if(k==='gy') t.gateYes+=n;
            else if(k==='sc_cons'||k==='sc_real'||k==='sc_opt') scen[k.slice(3)]+=n;
            else if(k==='ln_he'||k==='ln_en') lang[k.slice(3)]+=n;
            else if(own(FIN_IX,k)) fin[FIN_IX[k]]+=n;
            if(own(DID,k)){ devs[dev]=(devs[dev]||0)+n; if(pl==='app'||pl==='pwa') plat[pl]+=n; }
          });
        });
      });
    });
    // status changes that stand: a change that was undone and the undo itself cancel out (a mistaken click put right
    // at once is no change); a redo stands again. The log's time is the database's; the range starts at local midnight.
    var byId={};
    (rep.log||[]).forEach(function(e){ if(e&&e.id!=null) byId[e.id]=e; });
    (rep.log||[]).forEach(function(e){
      if(!e||e.f!=='s'||!own(per,e.u)) return;
      if(e.undone===true||undoDepth(e,byId)%2===1) return;
      var ts=+e.ts; if(ts&&ts<from) return;
      if(devF&&e.dev!==devF) return;
      per[e.u].changes++; t.changes++;
    });
    return {per:per,t:t,scen:scen,fin:fin,lang:lang,plat:plat,devs:devs};
  }
  // rows: [label html, count, full text?]; with the text the label carries it as a title and reads in its own direction;
  // two = the label on its own row (device names, which run long and in either language)
  function bars(rows,two){
    var max=rows.reduce(function(m,r){ return Math.max(m,r[1]); },0);
    if(!max) return '<p class="mza-note">'+L('אין נתונים בטווח הזה.','No data in this range.')+'</p>';
    return rows.map(function(r){
      var w=Math.round(r[1]/max*100);
      return '<div class="mza-bar'+(two?' mza-bar2':'')+'"><span class="mza-bar-l"'+(r[2]!=null?' dir="auto" title="'+esc(r[2])+'"':'')+'>'+r[0]+'</span><span class="mza-bar-t" aria-hidden="true"><i style="width:'+w+'%"></i></span><b>'+fmtInt(r[1])+'</b></div>';
    }).join('');
  }
  function topList(title,A,key){
    var list=UNITS.filter(function(c){ return A.per[c][key]>0; }).sort(function(a,b){ return A.per[b][key]-A.per[a][key]||UNITS.indexOf(a)-UNITS.indexOf(b); }).slice(0,3);
    return '<div class="mza-box"><h5>'+title+'</h5>'+(list.length?'<ol>'+list.map(function(c,i){ return '<li><span class="mza-rank" aria-hidden="true">'+(i+1)+'</span><b dir="ltr">'+c+'</b><bdi>'+esc(unitName(c))+'</bdi><span class="mza-cnt">'+fmtInt(A.per[c][key])+'</span></li>'; }).join('')+'</ol>':'<p class="mza-note" style="margin:0">—</p>')+'</div>';
  }
  function stChip(s){ return '<span class="mza-st mza-st-'+s+'">'+stName(s)+'</span>'; }
  var RANGES=[[7,'7 ימים','7 days'],[30,'30 יום','30 days'],[90,'90 יום','90 days'],[0,'הכול','All']];
  function rangeChips(){
    return RANGES.map(function(r){
      return '<button type="button" class="mza-chip'+(adm.repRange===r[0]?' on':'')+'" data-range="'+r[0]+'" aria-pressed="'+(adm.repRange===r[0])+'">'+L(r[1],r[2])+'</button>';
    }).join('');
  }
  // the device list: the busiest first (an invented id costs the flooder nothing - the list must stay readable), this
  // device and the one chosen always in it
  function devOptions(){
    var cnt={};
    if(adm.rep){
      Object.keys(adm.rep.devices).forEach(function(k){ cnt[k]=0; });
      var A0=aggregate(adm.rep,'',adm.repFrom);
      Object.keys(A0.devs).forEach(function(k){ cnt[k]=A0.devs[k]; });
    }
    var ids=Object.keys(cnt).sort(function(a,b){ return cnt[b]-cnt[a]||devName(a).localeCompare(devName(b)); }).slice(0,DEV_OPTIONS);
    [devId,adm.dev].forEach(function(k){ if(k&&cnt[k]!=null&&ids.indexOf(k)<0) ids.push(k); });
    return '<option value="">'+L('כל המכשירים','All devices')+'</option>'+ids.sort(function(a,b){ return devName(a).localeCompare(devName(b)); }).map(function(k){
      return '<option value="'+esc(k)+'"'+(adm.dev===k?' selected':'')+'>'+esc(devName(k))+'</option>';
    }).join('');
  }
  // the device list drawn again where it stands (not while it has the focus: that would close it under his finger)
  function devRefresh(){
    var s=ov&&ov.querySelector('#mzaDev'); adm.devDue=false;
    if(s&&s!==document.activeElement) s.innerHTML=devOptions();
  }
  // the filters, then the body (the read's state, the numbers): refreshAround draws them again apart
  function statsHtml(){
    return '<div class="mza-filters"><span class="mza-seg" id="mzaRanges" role="group" aria-label="'+L('טווח זמן','Time range')+'">'+rangeChips()+'</span>'+
      '<label>'+L('מכשיר','Device')+' <select class="mza-select" id="mzaDev">'+devOptions()+'</select></label>'+reloadBtn('mzaRepReload')+'</div>'+
      '<div id="mzaRepBody">'+repBodyHtml()+'</div>';
  }
  function repBodyHtml(){
    var head=repHead(true), h=head; if(repOther(true)) return head;
    var A=aggregate(adm.rep,adm.dev,adm.repFrom), T=A.t, cur0=baseUnits();
    function kpi(n,label,sub){ return '<div class="mza-kpi"><b>'+fmtInt(n)+'</b><span>'+label+'</span>'+(sub?'<small>'+sub+'</small>':'')+'</div>'; }
    h+='<div class="mza-kpis">'+
      kpi(T.view,L('צפיות בדירות','Apartment views'))+
      kpi(T.plan,L('תשריט / הדמיה נפתחו','Plan or renders opened'))+
      kpi(T.export,L('חוברות שהופקו','Booklets exported'))+
      kpi(T.mail,L('חוברות שנשלחו במייל','Booklets e-mailed'),L(fmtInt(T.rcpt)+' נמענים',fmtInt(T.rcpt)+' recipients'))+
      kpi(T.print,L('הדפסות','Prints'))+
      kpi(T.changes,L('שינויי סטטוס','Status changes'))+
      kpi(T.gateYes,L('נכנסו לדירה נמכרת/שמורה','Opened a sold/reserved unit'),L('מתוך '+fmtInt(T.gate)+' פעמים','out of '+fmtInt(T.gate)+' prompts'))+
      kpi(Object.keys(A.devs).length,L('מכשירים פעילים','Active devices'))+
      '</div>';
    var order=UNITS.slice().sort(function(a,b){ return A.per[b].view-A.per[a].view||UNITS.indexOf(a)-UNITS.indexOf(b); });
    var FUN=[['#d8b46a','צפיות','views'],['#9fc0d6','תשריט / הדמיה','plan / renders'],['#6fc2b0','חוברות','booklets'],['#f0a83c','במייל','e-mailed']];
    h+='<h4>'+L('לפי דירה','By apartment')+'</h4><div class="mza-tablewrap"><table class="mza-table"><thead><tr>'+
      '<th scope="col">'+L('דירה','Apartment')+'</th><th scope="col" class="n">'+L('צפיות','Views')+'</th><th scope="col" class="n">'+L('תשריט / הדמיה','Plan / renders')+'</th><th scope="col" class="n">'+L('חוברות','Booklets')+'</th><th scope="col" class="n">'+L('במייל','E-mailed')+'</th><th scope="col" class="n">'+L('שינויי סטטוס','Status changes')+'</th><th scope="col">'+L('סטטוס','Status')+'</th><th scope="col" class="mza-fun-col">'+L('משפך','Funnel')+'</th></tr></thead><tbody>'+
      order.map(function(c){
        var x=A.per[c], base=Math.max(x.view,x.plan,x.export,x.mail)||1;
        var fun=[x.view,x.plan,x.export,x.mail].map(function(v,i){ return v?'<i class="f'+i+'" style="width:'+Math.max(4,Math.round(v/base*100))+'%"></i>':'<i class="f'+i+' z"></i>'; }).join('');
        var tip=[x.view,x.plan,x.export,x.mail].map(function(v,i){ return L(FUN[i][1],FUN[i][2])+' '+v; }).join(' · ');
        return '<tr><th scope="row"><b dir="ltr">'+c+'</b></th><td class="n">'+fmtInt(x.view)+'</td><td class="n">'+fmtInt(x.plan)+'</td><td class="n">'+fmtInt(x.export)+'</td><td class="n">'+fmtInt(x.mail)+'</td><td class="n">'+fmtInt(x.changes)+'</td><td>'+stChip(cur0[c].s)+'</td><td class="mza-fun-col"><span class="mza-fun" title="'+esc(tip)+'" role="img" aria-label="'+esc(tip)+'">'+fun+'</span></td></tr>';
      }).join('')+'</tbody></table></div>'+
      '<p class="mza-legend mza-fun-col">'+FUN.map(function(f){ return '<span><i style="background:'+f[0]+'"></i>'+L(f[1],f[2])+'</span>'; }).join('')+'</p>';
    h+='<h4>'+L('המובילות','Top apartments')+'</h4><div class="mza-grid3">'+topList(L('הכי נצפות','Most viewed'),A,'view')+topList(L('הכי נשלחו במייל','Most e-mailed'),A,'mail')+topList(L('הכי הרבה שינויי סטטוס','Most status changes'),A,'changes')+'</div>';
    // the busiest devices, each name on its own row (in its own direction, the whole of it in the title)
    var devAll=Object.keys(A.devs).sort(function(a,b){ return A.devs[b]-A.devs[a]; });
    var devRows=devAll.slice(0,DEV_BARS).map(function(k){ var n=devName(k); return [esc(n),A.devs[k],n]; });
    var more=devAll.length-devRows.length;
    function iso(t){ return '<bdi dir="ltr">'+t+'</bdi>'; }   // "1–30%" read left to right inside the Hebrew
    h+='<h4>'+L('פילוח','Breakdown')+'</h4><div class="mza-grid3">'+
      '<div class="mza-box"><h5>'+L('תרחיש בחוברות','Booklet scenario')+'</h5>'+bars([[L('שמרני','Conservative'),A.scen.cons],[L('ריאלי','Realistic'),A.scen.real],[L('אופטימי','Optimistic'),A.scen.opt]])+'</div>'+
      '<div class="mza-box"><h5>'+L('מימון בחוברות','Booklet financing')+'</h5>'+bars([[L('ללא מימון','None'),A.fin[0]],[iso('1–30%'),A.fin[1]],[iso('31–50%'),A.fin[2]],[iso('51%+'),A.fin[3]]])+'</div>'+
      '<div class="mza-box"><h5>'+L('שפת החוברות','Booklet language')+'</h5>'+bars([[L('עברית','Hebrew'),A.lang.he],[L('אנגלית','English'),A.lang.en]])+'</div>'+
      '<div class="mza-box"><h5>'+L('מכשיר','Device')+'</h5>'+bars(devRows,true)+(more>0?'<p class="mza-note mza-more">'+L('ועוד '+fmtInt(more)+' מכשירים','and '+fmtInt(more)+' more devices')+'</p>':'')+'</div>'+
      '<div class="mza-box"><h5>'+L('פלטפורמה','Platform')+'</h5>'+bars([[L('אפליקציה','App'),A.plat.app],[L('דפדפן / iPad','Web / iPad'),A.plat.pwa]])+'</div>'+
      '</div>';
    return h;
  }

  /* -- tab 3: the log */
  function sameVal(f,a,b){ return f==='p'?Math.round(+a)===Math.round(+b):String(a)===String(b); }
  function validVal(f,v){ return f==='s'?STATUSES.indexOf(v)>=0:(typeof v==='number'&&Math.round(v)===v&&v>=PRICE_MIN&&v<=PRICE_MAX); }
  // the client-side conflict check: only while the field still holds what that change made it (the rules' rev check
  // refuses a write over a newer state anyway)
  function canUndo(e){
    if(!e||e.undone===true||!cur||UNITS.indexOf(e.u)<0||(e.f!=='s'&&e.f!=='p')||!validVal(e.f,e.from)) return false;
    var x=cur.units[e.u]; return !!x&&sameVal(e.f,x[e.f],e.to);
  }
  function logEntry(id){ var l=adm.rep&&adm.rep.log||[]; for(var i=0;i<l.length;i++) if(l[i].id===id) return l[i]; return null; }
  function valText(f,v){ return f==='p'?ltr(eur(v)):(STATUSES.indexOf(v)>=0?stName(v):esc(v)); }
  function logHtml(){
    var head=repHead(false); if(!adm.rep) return head;
    var log=adm.rep.log;
    var h='<div class="mza-filters"><span class="mza-note" style="flex:1 1 auto">'+L('השינויים האחרונים, מהחדש לישן.','The latest changes, newest first.')+'</span>'+reloadBtn()+'</div>'+head;
    if(!log.length) return h+'<p class="mza-note">'+L('עוד אין שינויים ביומן.','No changes in the log yet.')+'</p>';
    var arrow=L(' ← ',' → ');
    h+='<div class="mza-tablewrap"><table class="mza-table"><thead><tr><th scope="col">'+L('מתי','When')+'</th><th scope="col">'+L('מכשיר','Device')+'</th><th scope="col">'+L('דירה','Apartment')+'</th><th scope="col">'+L('שינוי','Change')+'</th><th scope="col"><span class="mza-ltr" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">'+L('בטל שינוי','Undo')+'</span></th></tr></thead><tbody>'+
      log.map(function(e){
        var und=e.undone===true, isUndo=e.undoOf!=null&&e.undoOf!=='';
        var what=(isUndo?L('ביטול: ','Undo: '):'')+(e.f==='p'?L('מחיר','Price'):L('סטטוס','Status'))+': '+valText(e.f,e.from)+arrow+valText(e.f,e.to);
        var btn=canUndo(e)?'<button type="button" class="mza-btn mza-no mza-sm" data-act="undo" data-id="'+esc(e.id)+'"'+(adm.busy.undo?' disabled':'')+' aria-label="'+esc(L('ביטול השינוי ב-'+e.u,'Undo the change to '+e.u))+'">'+L('בטל שינוי','Undo')+'</button>':(und?'<span class="mza-note">'+L('בוטל','Undone')+'</span>':'');
        return '<tr'+(und?' class="mza-undone"':'')+'><td style="white-space:nowrap">'+ltr(fmtTime(e.ts))+'</td><td>'+esc(devName(e.dev))+'</td><td><b dir="ltr">'+esc(e.u)+'</b></td><td class="mza-chg">'+what+'</td><td>'+btn+'</td></tr>';
      }).join('')+'</tbody></table></div>';
    return h;
  }
  // Undo of log row X: the field back to X.from, rev + 1, the database's time, a new row (undoOf: X) and X marked
  // undone - one write, so the state and the log never disagree. again: the retry after a renewed session.
  function undo(id,again){
    if(adm.busy.undo||id==null) return;
    if(!getAuth()){ needLogin(null); return; }
    adm.busy.undo=true; renderPanel(true);
    var e=null, rev=0, next=null;
    serverState().then(function(s){
      if(!s.ok) return s;
      e=logEntry(id);
      if(s.none||!canUndo(e)) return {ok:false,error:'conflict'};
      var body={}, nid=logId();
      rev=cur.rev; next=copyUnits(cur.units); next[e.u][e.f]=e.from;
      body['state/units/'+e.u+'/'+e.f]=e.from; body['state/rev']=rev+1; body['state/at']=TS;
      body['log/'+nid]={ts:TS,dev:devId,u:e.u,f:e.f,from:cur.units[e.u][e.f],to:e.from,undoOf:String(e.id)};
      body['log/'+e.id+'/undone']=true;
      return freshToken().then(function(t){ return t.ok?dbPatch(body,t.token):t; });
    }).then(function(r){
      adm.busy.undo=false;
      if(r.ok){
        setState({rev:rev+1,at:Date.now(),units:next},'server');
        e.undone=true;   // until the log is read again
        if(view==='admin'){ toast(L('השינוי בוטל.','The change was undone.')); loadRep(true); renderPanel(true); }
        return;
      }
      if(r.error==='auth'){ needLogin(r); return; }
      // refused: as a save is (above) - the session renewed and the field unchanged: once more by itself; otherwise
      // another device changed that field since: show what is there now, and the log as it is now
      if(r.error==='http'&&r.status===401){
        freshToken(/expired/i.test(String(r.code||''))).then(function(t){
          if(!t.ok&&t.error==='auth'){ needLogin(t); return; }
          fetchState().then(function(){
            var e2=logEntry(id);
            if(!again&&e2&&canUndo(e2)){ undo(id,true); return; }
            loadRep(true);
            if(view==='admin'){ renderPanel(true); toast(errText({error:e2&&canUndo(e2)?'denied':'conflict'}),true); }
          });
        });
        return;
      }
      if(r.error==='conflict'){ fetchState(); loadRep(true); }
      if(view==='admin'){ renderPanel(true); toast(errText(r),true); }
    });
  }

  /* -- tab 4: settings */
  function settingsHtml(){
    var r=adm.rep, lb=r&&r.labels[devId], a=readAuth()||{};
    var label=adm.labelText!=null?adm.labelText:(typeof lb==='string'?lb:'');
    var h='<div class="mza-set"><h4>'+L('המכשיר הזה','This device')+'</h4>'+
      '<label class="mza-lbl" for="mzaLabel">'+L('שם המכשיר (כך יופיע בסטטיסטיקה וביומן)','Device name (as it appears in the statistics and the log)')+'</label>'+
      '<div class="mza-row"><input id="mzaLabel" class="mza-input" type="text" maxlength="40" autocomplete="off" value="'+esc(label)+'" placeholder="'+esc(device.host||uaLabel())+'">'+
      '<button type="button" class="mza-btn mza-yes mza-sm" data-act="label"'+(adm.busy.label?' disabled':'')+'>'+(adm.busy.label?L('שומר…','Saving…'):L('שמירה','Save'))+'</button></div>'+
      '<dl class="mza-kv"><dt>'+L('מזהה','ID')+'</dt><dd>'+ltr(devId)+'</dd><dt>'+L('מחשב','Host')+'</dt><dd>'+ltr(device.host||uaLabel())+'</dd><dt>'+L('פלטפורמה','Platform')+'</dt><dd>'+(PLAT==='app'?L('אפליקציה','App'):L('דפדפן / iPad','Web / iPad'))+(device.ver?' '+ltr('v'+device.ver):'')+'</dd></dl></div>';
    h+='<div class="mza-set"><h4>'+L('החשבון','Account')+'</h4>'+
      '<dl class="mza-kv"><dt>'+L('מחובר בתור','Signed in as')+'</dt><dd>'+ltr(a.email||'')+'</dd></dl>'+
      '<p class="mza-note" style="margin:0 0 10px">'+L('הסיסמה נקבעת בעמוד של Google: "שינוי סיסמה" שולח לכתובת הזו מייל עם קישור.','The password is set on a Google page: "Change password" sends this address an e-mail with a link.')+'</p>'+
      '<div class="mza-row"><button type="button" class="mza-btn mza-no mza-sm" data-act="pwreset"'+(adm.busy.pw?' disabled':'')+'>'+(adm.busy.pw?L('שולח…','Sending…'):L('שינוי סיסמה','Change password'))+'</button>'+
      '<button type="button" class="mza-btn mza-no mza-sm" data-act="logout">'+L('יציאה ממסך הניהול','Sign out')+'</button></div></div>';
    return h+connSetHtml();
  }
  // the connection box (drawn again on its own while he types the device's name: refreshAround)
  function connSetHtml(){
    var box=readBox().length, h;
    var st=net.state==='off'?L('לא מקוון','Offline'):net.state==='on'?(stream.live?L('מחובר · עדכונים חיים','Connected · live updates'):L('מחובר','Connected')):L('לא נבדק','Not checked');
    h='<div class="mza-set" id="mzaSetConn"><h4>'+L('חיבור','Connection')+'</h4><dl class="mza-kv">'+
      '<dt>'+L('מצב','Status')+'</dt><dd>'+st+'</dd>'+
      '<dt>'+L('נתוני הדירות','Apartment data')+'</dt><dd>'+(cur&&cur.src==='server'?L('מהשרת','from the server'):cur?L('שמורים במכשיר','saved on this device'):L('מובנים באפליקציה','built into the app'))+(cur&&cur.rev?' · '+L('עדכון מס׳ ','update #')+ltr(String(cur.rev)):'')+(net.lastOk?' · '+L('סנכרון אחרון ','last sync ')+ltr(fmtTime(net.lastOk)):'')+'</dd>'+
      '<dt>'+L('אירועים בתור','Queued events')+'</dt><dd>'+fmtInt(box)+'</dd></dl>'+
      '<div class="mza-row"><button type="button" class="mza-btn mza-no mza-sm" data-act="ping"'+(adm.busy.ping?' disabled':'')+'>'+(adm.busy.ping?L('בודק…','Checking…'):L('בדיקת חיבור','Check the connection'))+'</button></div></div>';
    return h;
  }
  // the owner's name for this device (labels/{dev}); an empty name takes it away. again: the name once more (v) after a
  // renewed ID token
  function saveLabel(again,val){
    if(adm.busy.label||!ov) return;
    var inp=ov.querySelector('#mzaLabel'), v=again?val:String(inp&&inp.value||'').replace(/\s+/g,' ').trim().slice(0,40);
    if(!getAuth()){ needLogin(null); return; }
    adm.busy.label=true; adm.labelText=v; renderPanel(true);
    freshToken().then(function(t){
      if(!t.ok) return t;
      var b={}; b['labels/'+devId]=v||null;
      return dbPatch(b,t.token);
    }).then(function(r){
      adm.busy.label=false;
      if(r.ok){
        adm.labelText=null;
        if(adm.rep){ if(v) adm.rep.labels[devId]=v; else delete adm.rep.labels[devId]; }
        if(view==='admin'){ renderPanel(true); toast(L('השם נשמר.','The name was saved.')); }
        return;
      }
      // refused as expired: renewed at once and saved once more (as a save is); any other refusal - sign in again
      if(r.status===401&&!again&&/expired/i.test(String(r.code||''))){
        freshToken(true).then(function(t){
          if(t.ok){ saveLabel(true,v); return; }
          if(t.error==='auth'){ needLogin(t); return; }
          if(view==='admin'){ renderPanel(true); toast(errText(t),true); }
        });
        return;
      }
      if(r.error==='auth'||r.status===401){ needLogin({error:'auth'}); return; }
      if(view==='admin'){ renderPanel(true); toast(errText(r),true); }
    });
  }
  // "Change password": the reset e-mail to the address he is signed in with; he sets the new one on Google's page
  function changePassword(){
    if(adm.busy.pw) return;
    var a=getAuth(); if(!a){ needLogin(null); return; }
    var email=String(a.email||'');
    adm.busy.pw=true; renderPanel(true);
    sendReset(email).then(function(r){
      adm.busy.pw=false;
      if(view!=='admin') return;
      renderPanel(true);
      if(r.ok) toast(L('נשלח מייל ל-'+email+' עם קישור לבחירת סיסמה חדשה.','An e-mail with a link to choose a new password was sent to '+email+'.'));
      else toast(errText(r),true);
    });
  }
  function ping(){
    if(adm.busy.ping) return;
    adm.busy.ping=true; renderPanel(true);
    if(!stream.es) openStream();
    fetchState().then(function(r){
      adm.busy.ping=false;
      if(view==='admin'){ renderPanel(true); toast(r.ok?L('החיבור תקין.','The connection works.'):errText(r),!r.ok); }
    });
  }
  // Sign out: the session goes from this page at once (over REST there is nothing to tell Google: the ID token this page
  // held simply runs out within the hour, and nothing else has it) - and whatever was left unsaved goes with it, so the
  // next person to sign in here does not save it along with their own.
  function logout(){
    clearAuth();
    adm.pending={}; adm.ptext={}; adm.saveErr=''; adm.rep=null; adm.repLoaded=-1; adm.labelText=null; adm.uid='';
    closeOverlay(true);
  }

  /* -- events inside the overlay */
  function onClick(e){
    var t=e.target;
    if(idleLock()) return;   // after IDLE_MS away: the card locks, and the click does nothing else
    useAuth();
    // a stray tap beside the card closes it - but not over changes he has not saved (× and Escape ask first)
    if(t===ov){ if(downOnBackdrop&&!(view==='admin'&&hasUnsaved())) closeOverlay(); return; }
    var b=t&&t.closest?t.closest('button'):null;
    if(!b||!ov.contains(b)||b.disabled) return;
    var tab=b.getAttribute('data-tab'); if(tab){ setTab(tab); return; }
    var s=b.getAttribute('data-s'), u=b.closest('[data-u]');
    if(s&&u){ pickStatus(u.getAttribute('data-u'),s); return; }
    var rg=b.getAttribute('data-range');
    if(rg!=null){ adm.repRange=+rg||0; adm.repErr=null; loadRep(true); renderPanel(true); refocus({range:String(adm.repRange)}); return; }
    switch(b.getAttribute('data-act')){
      case 'close': closeOverlay(); break;
      case 'forgot': forgot(); break;
      case 'save': save(); break;
      case 'discard': discard(); break;
      case 'reload': adm.repErr=null; loadRep(true); break;
      case 'undo': undo(b.getAttribute('data-id')); break;
      case 'label': saveLabel(); break;
      case 'pwreset': changePassword(); break;
      case 'ping': ping(); break;
      case 'logout': logout(); break;
      case 'keep': dropConfirm(); refocus({act:'save'}); break;
      case 'cf-drop': adm.pending={}; adm.ptext={}; adm.saveErr=''; closeOverlay(true); break;
      case 'cf-save': dropConfirm(); adm.closeAfterSave=true; save(); break;
      case 'gobad': {
        var bad=ov.querySelector('.mza-unit input.mza-bad');
        if(bad){ try{ bad.scrollIntoView({block:'center'}); bad.focus({preventScroll:true}); }catch(x){} }
        break;
      }
    }
  }
  function onInput(e){
    var t=e.target; if(!t||t.tagName!=='INPUT') return;
    if(idleLock()) return;
    useAuth();
    var c=t.getAttribute('data-p');
    if(c){ typePrice(c,t); return; }
    if(t.id==='mzaEmail'||t.id==='mzaPass'){ if(signUi.err||signUi.info){ signUi.err=null; signUi.info=null; signRefresh(); } return; }
    if(t.id==='mzaLabel') adm.labelText=t.value;
  }
  function onChange(e){
    var t=e.target;
    if(t&&t.id==='mzaDev'){ adm.dev=t.value; renderPanel(true); refocus({id:'mzaDev'}); }
  }
  // the device list owes a redraw (new numbers came while it had the focus): its options now, nothing else around it
  function onFocusOut(e){
    var t=e.target, c=t&&t.getAttribute&&t.getAttribute('data-p');
    if(c) blurPrice(c,t);
    else if(t&&t.id==='mzaDev'&&adm.devDue) setTimeout(devRefresh,0);
  }
  function onKeydown(e){
    var t=e.target; if(!t) return;
    useAuth();   // (a key after IDLE_MS away never gets here: the window's handler locks the card first)
    if(e.key==='Enter'){
      if(t.id==='mzaLabel'){ e.preventDefault(); saveLabel(); return; }
      if(t.getAttribute('data-p')){ e.preventDefault(); blurPrice(t.getAttribute('data-p'),t); return; }
    }
    // the tabs: the arrow keys move between them (in reading order: right-to-left in Hebrew)
    if(t.getAttribute&&t.getAttribute('role')==='tab'&&(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='Home'||e.key==='End')){
      e.preventDefault();
      var i=TABS.map(function(x){ return x[0]; }).indexOf(adm.tab), n=TABS.length, fwd=(e.key==='ArrowLeft')===!isEn();
      var j=e.key==='Home'?0:e.key==='End'?n-1:(i+(fwd?1:-1)+n)%n;
      setTab(TABS[j][0]);
    }
  }

  /* ---------------------------------------------------------------- the language */
  // harbour-i18n flips html.lang-en; everything here is drawn in the right language by L(), so it is drawn again
  function onLang(){
    labelEntry();
    if(isOpen()){
      var keep={}, asking=!!confirmEl();
      Array.prototype.forEach.call(ov.querySelectorAll('input[id]'),function(i){ keep[i.id]=i.value; });
      var a=document.activeElement, fk=a&&ov.contains(a)&&!asking?focusKey(a):null;
      render();
      Object.keys(keep).forEach(function(id){ var i=ov.querySelector('#'+id); if(i) i.value=keep[id]; });
      keep=null;
      if(asking) askClose(); else if(fk) refocus(fk);
    }
    var r=document.getElementById('mzaResOverlay'); if(r&&r.classList.contains('open')) resTexts(r);
  }
  function watchLang(){
    var en=isEn();
    try{ new MutationObserver(function(){ var n=isEn(); if(n===en) return; en=n; onLang(); }).observe(document.documentElement,{attributes:true,attributeFilter:['class']}); }catch(e){}
  }

  /* ---------------------------------------------------------------- start */
  injectCss();
  installWrappers();
  // registered after sold-gate-js's own DOMContentLoaded handler, so the baked SOLD list is on the buttons first
  ready(function(){
    try{
      bakedFromPage();
      installWrappers();   // anything defined after this file was parsed
      var c=lsGet(K_STATE); if(c&&c.units) setState(c,'cache');   // the last state this device saw, over the baked one
      addEntry();
      watchLang();
      askDevice();
      openStream();
      if(!stream.es) fetchState();   // no stream (no EventSource, offline, off screen): one read now, then the poll
      setInterval(poll,POLL_MS);
      setInterval(function(){ flush(); },FLUSH_MS);
      setInterval(function(){ watchStream(); idleLock(); },TICK_MS);   // a silent stream; an open card left alone
      whenDevice(function(){ setTimeout(function(){ flush(); },4000); });
      document.addEventListener('visibilitychange',function(){
        if(document.visibilityState==='hidden'){ flush('hidden'); goHidden(); }
        else { idleLock(); if(onScreen) goVisible(); }
      });
      window.addEventListener('pagehide',function(){ flush('unload'); goHidden(); });
      window.addEventListener('offline',function(){ goHidden(); if(view==='admin') refreshConn(); });
      window.addEventListener('online',function(){ goVisible(); flush(); });
    }catch(e){ try{ console.error('harbour-admin',e); }catch(e2){} }
  });
})();
