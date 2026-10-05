/* The e-mail that goes with the apartment booklets (his template, 2026-09-27), in its Hebrew
   variants: one reader or several, and for one reader a man or a woman. The body is composed as
   PLAIN TEXT - that is what he sees and edits before sending - and the HTML part is derived from
   the final text at send time, so an edit is never lost.

   Loaded by harbour.html (window.MAOZ_MAIL_TEMPLATE) and by the node test
   (scripts/test-mail-template.mjs). Plain ES5 on purpose: it runs inside the old-style doc. */
(function (root) {
  'use strict';

  // the floor phrase comes from the unit code's letter, not from the strip on screen
  var FLOOR = { Y: 'בקומת הגן', I: 'בקומת הקרקע', A: 'בקומה הראשונה', B: 'בקומה השנייה', C: 'בקומה השלישית' };

  // "Comfort Suite C2 בקומה השלישית", "Garden Comfort Y3 (Golden Visa) בקומת הגן"
  function aptLabel(code, name) {
    var n = String(name || code || '').trim();
    if (code === 'Y3' && n.indexOf('Golden Visa') === -1) n += ' (Golden Visa)';
    var f = FLOOR[String(code || '').charAt(0)] || '';
    return f ? n + ' ' + f : n;
  }

  function apartmentsLines(labels) {
    var out = [labels.length > 1 ? 'מצ"ב מחשבוני השקעה + תשריטים ומפרטים טכניים של הדירות' : 'מצ"ב מחשבון השקעה + תשריט ומפרט טכני של דירה'];
    for (var i = 0; i < labels.length; i++) out.push(' \u200F' + labels[i]);
    out.push('ומצגת משקיעים של הפרויקט.');
    return out;
  }

  var BULLETS = [
    '19 יחידות דיור בוטיק - בפרויקט מנוהל לטווח קצר (דירות AIRBNB).',
    'ודאות וביטחון - רישום מלא בטאבו כולל ניהול כספים תחת חשבון נאמנות.',
    'פרויקט בלב ליבה של פיראוס, הממוקם ברחוב Kountouriotou 161, במרחק של כ-2 דקות הליכה ממרינה ZEA המפורסמת ובשדרה המרכזית Sotiros Dios המאופיינת במסחר, מסעדות ותיירות ענפה.',
    'מעטפת ליווי מלאה - שת"פ עם חברת היזמות והניהול המקומית BETA ESTATE אשר מרכזת את כלל שירותי הליווי: תכנון, בינוי, משפטי, פיננסי וניהול מלא של הנכס בשוטף.',
    'תנאי מיסוי נוחים - אמנת מס בין ישראל ליוון (מס רכישה נמוך ופטור מלא ממס שבח בעת המכירה).',
    'מודל תנאי מימון ייחודיים: חברת Loanwise - המאפשרת מימון עד 50% מעלות ההשקעה בריבית פריים + 0.5%.'
  ];

  /* opts: { names: 'יחיאל' | 'יחיאל ורחל', number: 's' | 'p', gender: 'm' | 'f' (singular only),
            apts: [{ code: 'C2', name: 'Comfort Suite C2' }, ...] (the one on screen first) } */
  function compose(opts) {
    var plural = opts.number === 'p';
    var female = !plural && opts.gender === 'f';
    var names = String(opts.names || '').replace(/\s+/g, ' ').replace(/[\s,.]+$/, '').trim();
    var dear = plural ? 'היקרים' : (female ? 'היקרה' : 'היקר');
    var you = plural ? 'אתכם' : 'אותך';
    var toYou = plural ? 'לכם' : 'לך';
    var request = plural ? 'לבקשתכם' : 'לבקשתך';
    var labels = (opts.apts || []).map(function (a) { return aptLabel(a.code, a.name); });
    var lines = [
      'היי ' + (names ? names + ' ' : '') + dear + ',',
      '',
      'שמחתי מאוד לפגוש ולהכיר ' + you + ' היום.',
      'בהמשך לפגישתנו, מצרף ' + toYou + ' מספר נקודות אודות ההשקעה בפרויקט שלנו "THE HARBOUR":',
      ''
    ];
    for (var i = 0; i < BULLETS.length; i++) lines.push('• ' + BULLETS[i]);
    lines.push('');
    lines.push(request + ',');
    lines = lines.concat(apartmentsLines(labels));
    lines.push('');
    lines.push('בברכה,');
    // the signature itself is his signature card, an image (SIGNATURE_CID below); the plain-text
    // part of the mail carries SIGNATURE_TEXT in its place (his ask, 2026-09-28)
    return {
      subject: 'Maoz Group - The Harbour Piraeus',   // always this (his ask, 2026-09-27)
      text: lines.join('\n')
    };
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // a Latin run (a name, an address, a street with its number, "THE HARBOUR") keeps its own
  // left-to-right order inside the right-to-left line; addresses and URLs are one run ('@', '/'),
  // and a run may hold spaces but always ends on a letter or digit. Escaping happens per piece so
  // the tags are never escaped and the entities are never split.
  var LATIN = /[A-Za-z][A-Za-z0-9@.\/:_+&'\- ]*[A-Za-z0-9\/]|[A-Za-z]/g;
  // the street is a real link to the building on Google Maps: Gmail's own guess at the address
  // linked to nothing (his report, 2026-09-27). The query was checked to land on Kountouriotou 161,
  // Pireas 185 35 (37.9411, 23.6485).
  var LINKS = { 'Kountouriotou 161': 'https://www.google.com/maps/search/?api=1&query=Kountouriotou+161,+Piraeus+185+35,+Greece' };
  function isolateLatin(raw) {
    var out = '', last = 0, m;
    LATIN.lastIndex = 0;
    while ((m = LATIN.exec(raw))) {
      var run = m[0], href = LINKS[run];
      out += esc(raw.slice(last, m.index)) + (href
        ? '<a href="' + esc(href) + '" dir="ltr" style="color:#1a73e8;text-decoration:underline">' + esc(run) + '</a>'
        : '<span dir="ltr">' + esc(run) + '</span>');
      last = m.index + run.length;
    }
    return out + esc(raw.slice(last));
  }
  var P = 'margin:0 0 14px;direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1a1a1a';

  /* His signature card (assets/mail/signature.png, 1250x625 - his new card of 2026-10-04 - shown at
     460 px): attached by the main process as an INLINE image with this Content-ID - Gmail and
     Outlook show cid images in the body and block data: URIs. The same id is in electron/mail.cjs.
     The text below goes into the plain-text part, for the few clients that show no HTML. */
  var SIGNATURE_CID = 'maoz-signature@maoz-group.com';
  var SIGNATURE_TEXT = 'MAOZ GROUP\nיזמות והשקעות נדל"ן\n054-3120630\ninfo@maoz-group.com\nרחוב החושלים 5, בניין A, קומה 1 | הרצליה פיתוח';
  var SIGNATURE_ALT = 'MAOZ GROUP | יזמות והשקעות נדל"ן | 054-3120630 | info@maoz-group.com | רחוב החושלים 5, בניין A, קומה 1, הרצליה פיתוח';

  // a paragraph of one short line that ends in a dash or a colon is a heading
  function isHeading(lines) {
    if (lines.length !== 1) return false;
    var t = lines[0].trim();
    return t.length <= 50 && /[-–:]$/.test(t) && !/^[•*\-]\s/.test(t);
  }

  // RTL-safe HTML for Gmail, Outlook (old and new), Apple Mail and phones: paragraphs and a
  // bullet TABLE (classic Outlook mangles right-to-left lists), every style inline.
  // opts.signatureCid: append the signature card as an inline image under the letter.
  function textToHtml(text, opts) {
    var paras = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
    var out = [];
    for (var i = 0; i < paras.length; i++) {
      var lines = paras[i].split('\n').filter(function (l) { return l.trim() !== ''; });
      if (!lines.length) continue;
      var allBullets = lines.every(function (l) { return /^\s*[•*\-]\s+/.test(l); });
      if (allBullets) {
        var rows = lines.map(function (l) {
          return '<tr><td dir="rtl" valign="top" width="18" style="padding:0 0 6px 8px;' + P + '">•</td>' +
            '<td dir="rtl" align="right" style="padding:0 0 6px;' + P + '">' + isolateLatin(l.replace(/^\s*[•*\-]\s+/, '')) + '</td></tr>';
        }).join('');
        out.push('<table role="presentation" dir="rtl" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;direction:rtl">' + rows + '</table>');
      } else if (isHeading(lines)) {
        // a section heading ("אודות התוכנית -", "דגשים נוספים אודות העסקה -"): bold and underlined, the
        // trailing dash or colon dropped since the line now marks it (his ask, 2026-10-03)
        out.push('<p dir="rtl" style="' + P.replace('margin:0 0 14px', 'margin:6px 0 8px') + ';font-weight:bold">' +
          '<span style="text-decoration:underline;text-underline-offset:4px">' + isolateLatin(lines[0].trim().replace(/\s*[-–:]\s*$/, '')) + '</span></p>');
      } else {
        out.push('<p dir="rtl" style="' + P + '">' + lines.map(function (l) { var m = /^( +)/.exec(l); return (m ? new Array(m[1].length * 2 + 1).join('&nbsp;') : '') + isolateLatin(l.replace(/^ +/, '')); }).join('<br>') + '</p>');
      }
    }
    if (opts && opts.signatureCid) {
      out.push('<table role="presentation" dir="rtl" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 0"><tr><td align="right">' +
        '<img src="cid:' + esc(opts.signatureCid) + '" width="460" height="230" alt="' + esc(SIGNATURE_ALT) + '" ' +
        'style="display:block;width:460px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none">' +
        '</td></tr></table>');
    }
    return '<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>THE HARBOUR</title></head>' +
      '<body dir="rtl" style="margin:0;padding:0;background:#ffffff">' +
      '<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td dir="rtl" align="right" style="direction:rtl;text-align:right;padding:24px 20px">' + out.join('') + '</td></tr></table></body></html>';
  }

  var api = { FLOOR: FLOOR, aptLabel: aptLabel, compose: compose, textToHtml: textToHtml, SIGNATURE_CID: SIGNATURE_CID, SIGNATURE_TEXT: SIGNATURE_TEXT };
  root.MAOZ_MAIL_TEMPLATE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
